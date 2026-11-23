import { describe, expect, it, vi } from 'vitest'
import type { DraftBook } from '~/shared/import/blocks'
import type { ArticleDraft } from './article-draft'
import type { SaveStage } from './article-messages'
import { type SaveSteps, saveArticle } from './article-save'

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 20, 0, 0, 0, 20,
])

const book = (pictures: number): DraftBook => ({
  title: 'A long read',
  author: 'Ada',
  language: 'en',
  details: { description: 'About it.', isbn: null, publisher: 'Site', publishedYear: 2026 },
  cover: null,
  chapters: [
    {
      title: 'A long read',
      blocks: [
        { type: 'paragraph', runs: [{ text: 'Text.' }] },
        ...Array.from({ length: pictures }, (_, i) => ({ type: 'image' as const, image: i + 1, alt: `p${i + 1}` })),
      ],
    },
  ],
  pictures: Array.from({ length: pictures }, (_, i) => ({
    key: `https://a.test/${i + 1}.png`,
    problem: 'remote' as const,
  })),
})

const draftOf = (pictures: number, capped = 0): ArticleDraft => ({
  book: book(pictures),
  pictureUrls: new Map(Array.from({ length: pictures }, (_, i) => [i + 1, `https://a.test/${i + 1}.png`])),
  capped,
})

const ok = { ok: true as const, value: true }

function steps(more: Partial<SaveSteps> = {}, draft = draftOf(2)): SaveSteps {
  return {
    fetchArticle: vi.fn(async () => ({
      ok: true as const,
      value: { fetch: 'f1', finalUrl: 'https://a.test/x', html: '<p>' },
    })),
    read: vi.fn(async () => ({ content: '<p>' })),
    draft: vi.fn(async () => ({ ok: true as const, draft })),
    fetchPicture: vi.fn(async () => PNG),
    drawPicture: vi.fn(async () => ({ blob: new Blob(['x'], { type: 'image/png' }), width: 20, height: 20 })),
    startArticle: vi.fn(async () => ({ ok: true as const, value: { id: 'b1', imageBytesLeft: 100 } })),
    upload: {
      uploadPicture: vi.fn(async () => ok),
      uploadChapter: vi.fn(async () => ok),
      finish: vi.fn(async () => ok),
      discard: vi.fn(),
    },
    ...more,
  }
}

const uploading = (more: Partial<SaveSteps['upload']>) => {
  const s = steps()
  return { ...s, upload: { ...s.upload, ...more } }
}

async function run(s: SaveSteps, imageBytesUsed = 0) {
  const progress: SaveStage[] = []
  const outcome = await saveArticle('a.test/x', s, { imageBytesUsed }, (p) => progress.push(p))
  return { outcome, progress }
}

describe('saveArticle', () => {
  it('fetches, finds, saves the pictures, then starts, uploads and finishes', async () => {
    const s = steps()
    const { outcome, progress } = await run(s)
    expect(outcome).toEqual({ ok: true, id: 'b1', failed: 0, capped: 0 })
    expect(progress).toEqual([
      { stage: 'fetching' },
      { stage: 'reading' },
      { stage: 'pictures', done: 0, total: 2 },
      { stage: 'pictures', done: 1, total: 2 },
      { stage: 'pictures', done: 2, total: 2 },
      { stage: 'saving' },
    ])
    expect(s.fetchPicture).toHaveBeenCalledWith('f1', 'https://a.test/1.png')
    expect(s.startArticle).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A long read', isbn: null, publisher: 'Site', chapterCount: 1, article: 'f1' }),
    )
    expect(s.upload.uploadPicture).toHaveBeenCalledTimes(2)
    expect(s.upload.uploadChapter).toHaveBeenCalledWith('b1', 0, expect.stringContaining('"image":2'))
    expect(s.upload.finish).toHaveBeenCalledWith('b1')
    expect(s.upload.discard).not.toHaveBeenCalled()
  })

  it('saves an article with no pictures without the pictures step', async () => {
    const { outcome, progress } = await run(steps({}, draftOf(0)))
    expect(outcome).toMatchObject({ ok: true })
    expect(progress.map((p) => p.stage)).toEqual(['fetching', 'reading', 'saving'])
  })

  it('drops a picture that can’t be fetched, sniffed or drawn, and goes on; a spacer isn’t counted', async () => {
    const answers = [null, new Uint8Array([1, 2, 3]), PNG, PNG]
    const s = steps(
      {
        fetchPicture: vi.fn(async () => answers.shift() as Uint8Array | null),
        drawPicture: vi
          .fn()
          .mockResolvedValueOnce({ problem: 'unreadable' })
          .mockResolvedValueOnce({ problem: 'small' }),
      },
      draftOf(4, 3),
    )
    const { outcome } = await run(s)
    expect(outcome).toEqual({ ok: true, id: 'b1', failed: 3, capped: 3 })
    expect(s.startArticle).toHaveBeenCalledWith(expect.objectContaining({ images: { count: 0, bytes: 0 } }))
  })

  it('leaves out the pictures past the account’s room', async () => {
    const s = steps()
    const { outcome } = await run(s, 250 * 1024 * 1024 - 1)
    expect(outcome).toMatchObject({ ok: true, failed: 1 })
  })

  it('stops at a failed fetch with its failure', async () => {
    const s = steps({
      fetchArticle: vi.fn(async () => ({
        ok: false as const,
        problem: 'exists' as const,
        failure: { problem: 'exists' as const, existingId: 'b0' },
      })),
    })
    expect((await run(s)).outcome).toEqual({ ok: false, failure: { problem: 'exists', existingId: 'b0' } })
    const bare = steps({ fetchArticle: vi.fn(async () => ({ ok: false as const, problem: 'blocked' as const })) })
    expect((await run(bare)).outcome).toEqual({ ok: false, failure: { problem: 'blocked' } })
  })

  it('is no_article when nothing is found, or reading throws', async () => {
    const none = steps({ draft: vi.fn(async () => ({ ok: false as const, problem: 'no_article' as const })) })
    expect((await run(none)).outcome).toEqual({ ok: false, failure: { problem: 'no_article' } })
    const throws = steps({ read: vi.fn(async () => Promise.reject(new Error('no DOM'))) })
    expect((await run(throws)).outcome).toEqual({ ok: false, failure: { problem: 'no_article' } })
  })

  it('stops at a refused start with its failure, before uploading anything', async () => {
    const s = steps({
      startArticle: vi.fn(async () => ({
        ok: false as const,
        problem: 'quota' as const,
        failure: { problem: 'quota' as const, plan: 'free' as const, max: 20 },
      })),
    })
    expect((await run(s)).outcome).toEqual({ ok: false, failure: { problem: 'quota', plan: 'free', max: 20 } })
    expect(s.upload.uploadPicture).not.toHaveBeenCalled()
    const bare = steps({ startArticle: vi.fn(async () => ({ ok: false as const, problem: 'expired' as const })) })
    expect((await run(bare)).outcome).toEqual({ ok: false, failure: { problem: 'expired' } })
  })

  it('deletes what it uploaded when a step after the start fails, and says failed', async () => {
    const s = uploading({ uploadChapter: vi.fn(async () => ({ ok: false as const, problem: 'invalid' as const })) })
    expect((await run(s)).outcome).toEqual({ ok: false, failure: { problem: 'failed' } })
    expect(s.upload.discard).toHaveBeenCalledWith('b1')
  })

  it('says signed_out when the reader was signed out part way', async () => {
    const s = uploading({ uploadChapter: vi.fn(async () => ({ ok: false as const, problem: 'signed-out' as const })) })
    expect((await run(s)).outcome).toEqual({ ok: false, failure: { problem: 'signed_out' } })
    expect(s.upload.discard).toHaveBeenCalledWith('b1')
  })

  it('fails before the start when no chapter has anything in it', async () => {
    const empty = draftOf(0)
    empty.book.chapters = [{ title: 'A long read', blocks: [] }]
    const s = steps({}, empty)
    expect((await run(s)).outcome).toEqual({ ok: false, failure: { problem: 'failed' } })
    expect(s.startArticle).not.toHaveBeenCalled()
  })
})
