import { describe, expect, it, vi } from 'vitest'
import type { DraftChapter } from '~/shared/import/blocks'
import {
  keptPictures,
  type PrivateBookDraft,
  type PrivateBookSteps,
  type SaveProgress,
  savePrivateBook,
} from './private-book-save'

const para = (text: string) => ({ type: 'paragraph' as const, runs: [{ text }] })
const chapters: DraftChapter[] = [
  { title: 'One', blocks: [para('a'), { type: 'image', image: 1, alt: '' }] },
  { title: 'Two', blocks: [para('b')] },
]
const blob = (bytes: number) => new Blob(['x'.repeat(bytes)], { type: 'image/png' })

const draftOf = (more: Partial<PrivateBookDraft> = {}): PrivateBookDraft => ({
  book: {
    title: 'A book',
    author: 'Ada',
    language: 'en',
    description: 'About it.',
    isbn: '9780141439518',
    publisher: 'House',
    publishedYear: 2026,
  },
  chapters,
  pictures: [blob(3), blob(4)],
  cover: { blob: blob(5), from: 'epub' },
  ...more,
})

type Refused = { ok: false; problem: 'quota'; note: string }
const ok = { ok: true as const, value: true }

function stepsOf(more: Partial<PrivateBookSteps<Refused>> = {}) {
  const calls: string[] = []
  const log =
    <A extends unknown[], T>(name: (...args: A) => string, answer: T) =>
    async (...args: A) => {
      calls.push(name(...args))
      return answer
    }
  const steps = {
    start: vi.fn(log(() => 'start', { ok: true as const, value: { id: 'b1' } })),
    uploadCover: vi.fn(log((_id: string, _b: Blob, from: string) => `cover ${from}`, { ok: true as const, value: {} })),
    uploadPicture: vi.fn(log((_id: string, n: number) => `picture ${n}`, ok)),
    uploadChapter: vi.fn(log((_id: string, position: number) => `chapter ${position}`, ok)),
    finish: vi.fn(log(() => 'finish', ok)),
    discard: vi.fn((id: string) => void calls.push(`discard ${id}`)),
    ...more,
  } satisfies PrivateBookSteps<Refused>
  return { steps, calls }
}

async function run(draft: PrivateBookDraft, steps: PrivateBookSteps<Refused>) {
  const progress: SaveProgress[] = []
  const result = await savePrivateBook(draft, steps, (p) => progress.push(p))
  return { result, progress }
}

describe('keptPictures', () => {
  it('gives the blobs in the plan’s order, or null when one is missing, so none is numbered wrong', () => {
    const [a, b] = [blob(1), blob(2)]
    const blobs = new Map([
      [4, a],
      [7, b],
    ])
    expect(keptPictures([7, 4], (n) => blobs.get(n))).toEqual([b, a])
    expect(keptPictures([], (n) => blobs.get(n))).toEqual([])
    expect(keptPictures([4, 5, 7], (n) => blobs.get(n))).toBeNull()
  })
})

describe('savePrivateBook', () => {
  it('starts the book, then uploads the cover, the pictures and the chapters, and finishes it', async () => {
    const { steps, calls } = stepsOf()
    const { result } = await run(draftOf(), steps)
    expect(result).toEqual({ ok: true, id: 'b1' })
    expect(calls).toEqual(['start', 'cover epub', 'picture 1', 'picture 2', 'chapter 0', 'chapter 1', 'finish'])
    expect(steps.start).toHaveBeenCalledWith({
      title: 'A book',
      author: 'Ada',
      language: 'en',
      chapterCount: 2,
      description: 'About it.',
      isbn: '9780141439518',
      publisher: 'House',
      publishedYear: 2026,
      images: { count: 2, bytes: 7 },
    })
    expect(steps.uploadChapter).toHaveBeenCalledWith('b1', 0, expect.stringContaining('"image":1'))
    expect(steps.uploadChapter).toHaveBeenCalledWith(
      'b1',
      1,
      '{"title":"Two","blocks":[{"type":"paragraph","runs":[{"text":"b"}]}]}',
    )
  })

  it('passes a refused start back untouched, and asks nothing more', async () => {
    const refused: Refused = { ok: false, problem: 'quota', note: 'kept' }
    const { steps, calls } = stepsOf({ start: vi.fn(async () => refused) })
    const { result } = await run(draftOf(), steps)
    expect(result).toEqual({ ok: false, at: 'start', refused })
    expect((result as { refused: Refused }).refused).toBe(refused)
    expect(calls).toEqual([])
  })

  const no = <P>(problem: P) => vi.fn(async () => ({ ok: false as const, problem }))
  it.each([
    ['a picture', { uploadPicture: no('type' as const) }, { at: 'picture', problem: 'type' }, 'chapter 0'],
    ['a chapter', { uploadChapter: no('empty' as const) }, { at: 'chapter', problem: 'empty' }, 'chapter 1'],
    ['the finish', { finish: no('incomplete' as const) }, { at: 'finish', problem: 'incomplete' }, null],
  ])('discards the book once when %s fails, and asks nothing after it', async (_what, more, failure, never) => {
    const { steps, calls } = stepsOf(more)
    const { result } = await run(draftOf(), steps)
    expect(result).toEqual({ ok: false, ...failure })
    expect(steps.discard).toHaveBeenCalledTimes(1)
    expect(steps.discard).toHaveBeenCalledWith('b1')
    expect(calls.at(-1)).toBe('discard b1')
    if (never) expect(calls).not.toContain(never)
  })

  it('keeps the limit a refused chapter or picture names, so the message can name it', async () => {
    const tooLong = {
      uploadChapter: vi.fn(async () => ({ ok: false as const, problem: 'article-too-large' as const, max: 99 })),
    }
    expect((await run(draftOf(), stepsOf(tooLong).steps)).result).toEqual({
      ok: false,
      at: 'chapter',
      problem: 'article-too-large',
      max: 99,
    })
    const full = { uploadPicture: vi.fn(async () => ({ ok: false as const, problem: 'quota-user' as const, max: 7 })) }
    expect((await run(draftOf(), stepsOf(full).steps)).result).toEqual({
      ok: false,
      at: 'picture',
      problem: 'quota-user',
      max: 7,
    })
  })

  it.each([
    ['a picture', { uploadPicture: vi.fn(async () => Promise.reject(new Error('x'))) }, 'picture'],
    ['a chapter', { uploadChapter: vi.fn(async () => Promise.reject(new Error('x'))) }, 'chapter'],
    ['the finish', { finish: vi.fn(async () => Promise.reject(new Error('x'))) }, 'finish'],
  ])('discards the book once and fails when %s throws', async (_what, more, at) => {
    const { steps } = stepsOf(more)
    const { result } = await run(draftOf(), steps)
    expect(result).toEqual({ ok: false, at, problem: 'failed' })
    expect(steps.discard).toHaveBeenCalledTimes(1)
    expect(steps.discard).toHaveBeenCalledWith('b1')
  })

  function deferredPictures() {
    const pending: { n: number; blob: Blob; answer: (ok: boolean) => void }[] = []
    let inFlight = 0
    let most = 0
    const uploadPicture = vi.fn(
      (_id: string, n: number, blob: Blob) =>
        new Promise<{ ok: true } | { ok: false; problem: 'type' }>((resolve) => {
          most = Math.max(most, ++inFlight)
          pending.push({
            n,
            blob,
            answer: (ok) => {
              inFlight--
              resolve(ok ? { ok: true } : { ok: false, problem: 'type' })
            },
          })
        }),
    )
    return { uploadPicture, pending, most: () => most }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve))

  it('uploads picture n as blob n, two at a time at most', async () => {
    const pictures = [blob(1), blob(2), blob(3), blob(4), blob(5)]
    const fake = deferredPictures()
    const { steps } = stepsOf({ uploadPicture: fake.uploadPicture })
    const saving = run(draftOf({ pictures }), steps)
    for (let answered = 0; answered < pictures.length; answered++) {
      await settle()
      fake.pending.shift()?.answer(true)
    }
    expect((await saving).result).toEqual({ ok: true, id: 'b1' })
    expect(fake.most()).toBe(2)
    expect(fake.uploadPicture.mock.calls.map(([, n, b]) => [n, b])).toEqual(pictures.map((b, i) => [i + 1, b]))
  })

  it('starts no picture after one fails, and discards once the one still uploading has answered', async () => {
    const fake = deferredPictures()
    const { steps } = stepsOf({ uploadPicture: fake.uploadPicture })
    const saving = run(draftOf({ pictures: [blob(1), blob(2), blob(3)] }), steps)
    await settle()
    fake.pending.shift()?.answer(false)
    await settle()
    expect(steps.discard).not.toHaveBeenCalled()
    fake.pending.shift()?.answer(true)
    expect((await saving).result).toEqual({ ok: false, at: 'picture', problem: 'type' })
    expect(fake.uploadPicture).toHaveBeenCalledTimes(2)
    expect(steps.discard).toHaveBeenCalledTimes(1)
  })

  it('says where it has got to, from before the start', async () => {
    const progress: string[] = []
    const say = (p: SaveProgress) => progress.push(`${p.stage} ${p.done}/${p.total}`)
    const { steps } = stepsOf({
      start: vi.fn(async () => {
        progress.push('start')
        return { ok: true as const, value: { id: 'b1' } }
      }),
    })
    await savePrivateBook(draftOf(), steps, say)
    expect(progress).toEqual([
      'cover 0/1',
      'start',
      'pictures 0/2',
      'pictures 1/2',
      'pictures 2/2',
      'chapters 0/2',
      'chapters 1/2',
      'chapters 2/2',
    ])
    progress.length = 0
    await savePrivateBook(draftOf({ cover: null }), stepsOf().steps, say)
    expect(progress[0]).toBe('pictures 0/2')
    progress.length = 0
    await savePrivateBook(draftOf({ cover: null, pictures: [] }), stepsOf().steps, say)
    expect(progress).toEqual(['chapters 0/2', 'chapters 1/2', 'chapters 2/2'])
  })

  it('saves the book when its cover is refused, and says why', async () => {
    const refusals = [
      ['small', 'small'],
      ['unreadable', 'type'],
      ['signed_out', 'unavailable'],
    ] as const
    for (const [problem, coverRefusal] of refusals) {
      const { steps } = stepsOf({ uploadCover: vi.fn(async () => ({ ok: false as const, problem })) })
      expect((await run(draftOf(), steps)).result).toEqual({ ok: true, id: 'b1', coverRefusal })
      expect(steps.finish).toHaveBeenCalled()
    }
    const throws = stepsOf({ uploadCover: vi.fn(async () => Promise.reject(new Error('x'))) })
    expect((await run(draftOf(), throws.steps)).result).toEqual({ ok: true, id: 'b1', coverRefusal: 'unavailable' })
    expect(throws.steps.discard).not.toHaveBeenCalled()
  })

  it('asks for no cover when the book has none', async () => {
    const { steps, calls } = stepsOf()
    await run(draftOf({ cover: null }), steps)
    expect(steps.uploadCover).not.toHaveBeenCalled()
    expect(calls[1]).toBe('picture 1')
  })

  it('trims the details, and an empty one is null', async () => {
    const { steps } = stepsOf()
    const book = { ...draftOf().book, description: '  About it. ', isbn: '  ', publisher: '' }
    await run(draftOf({ book, pictures: [] }), steps)
    expect(steps.start).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'About it.',
        isbn: null,
        publisher: null,
        images: { count: 0, bytes: 0 },
      }),
    )
  })
})
