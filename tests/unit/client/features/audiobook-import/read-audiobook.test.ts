import { readFileSync } from 'node:fs'
import { parseBlob } from 'music-metadata'
import { describe, expect, it, vi } from 'vitest'
import { AudiobookReadError, readAudiobook } from '~/client/features/audiobook-import/read-audiobook'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'

const fixture = (name: string, as = name) =>
  new File([readFileSync(new URL(`../../../../fixtures/audio/${name}`, import.meta.url))], as)

const read = (files: File[], options: Partial<Parameters<typeof readAudiobook>[1]> = {}) =>
  readAudiobook(files, { audioBytesUsed: 0, limits: DEFAULT_LIMITS, ...options })

async function refusal(files: File[], options: Partial<Parameters<typeof readAudiobook>[1]> = {}) {
  try {
    await read(files, options)
  } catch (error) {
    if (error instanceof AudiobookReadError) return error.problem
    throw error
  }
  throw new Error('read was not refused')
}

const sized = (name: string, size: number) => {
  const file = new File(['x'], name)
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const parsing = (seconds: number, chapters: { title: string; start: number }[] = [], common: object = {}) =>
  vi.fn(async () => ({
    format: { duration: seconds, chapters: chapters.map((c) => ({ ...c, timeScale: 1 })) },
    common: { track: { no: null, of: null }, disk: { no: null, of: null }, ...common },
  })) as unknown as typeof parseBlob

describe('readAudiobook', () => {
  it('reads three MP3s in track order, a chapter each, with the tags and the cover', async () => {
    const progress: [number, number][] = []
    const files = [
      fixture('chapter-3.mp3', 'c.mp3'),
      fixture('chapter-1.mp3', 'a.mp3'),
      fixture('chapter-2.mp3', 'b.mp3'),
    ]
    const draft = await read(files, { onProgress: (done, total) => progress.push([done, total]) })
    expect(draft).toMatchObject({
      type: 'mp3',
      title: 'The Fixture Audiobook',
      author: 'Ada Fixture',
      narrator: 'Rex Reader',
      language: 'en',
      details: { description: null, publishedYear: 2024 },
      from: 'files',
      totalMs: 3 * 10057,
    })
    expect(draft.files.map((f) => f.name)).toEqual(['a.mp3', 'b.mp3', 'c.mp3'])
    expect(draft.chapters.map((c) => [c.title, c.fileN, c.startMs, c.durationMs])).toEqual([
      ['The Arrival', 1, 0, 10057],
      ['The Dinner', 2, 0, 10057],
      ['The Departure', 3, 0, 10057],
    ])
    expect(draft.cover).toMatchObject({ from: 'audio', info: { type: 'image/jpeg', width: 400, height: 600 } })
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('reads an M4B’s own chapters, title, narrator and description', async () => {
    const draft = await read([fixture('three-chapters.m4b')])
    expect(draft).toMatchObject({
      type: 'mp4',
      title: 'The Fixture Audiobook',
      author: 'Ada Fixture',
      narrator: 'Rex Reader',
      details: { description: 'Three short chapters, in one file.', publishedYear: 2023 },
      from: 'file',
    })
    expect(draft.chapters.map((c) => [c.title, c.startMs])).toEqual([
      ['Opening Credits', 0],
      ['The Storm', 3000],
      ['The Calm', 6000],
    ])
    expect(draft.cover?.info.type).toBe('image/jpeg')
  })

  it('refuses DRM, other kinds of file, a cut-off file, and a mix', async () => {
    expect(await refusal([fixture('drm.m4b')])).toEqual({ code: 'drm' })
    expect(await refusal([new File(['%PDF-1.7 not audio at all'], 'x.mp3')])).toEqual({ code: 'type', type: null })
    const ogg = new File(
      [new Uint8Array([...'OggS'].map((c) => c.charCodeAt(0)).concat(new Array(40).fill(0)))],
      'a.ogg',
    )
    expect(await refusal([ogg])).toEqual({ code: 'type', type: 'Ogg' })
    expect(await refusal([fixture('truncated.m4b')])).toMatchObject({ code: 'unreadable' })
    expect(await refusal([fixture('three-chapters.m4b'), fixture('chapter-1.mp3')])).toEqual({ code: 'mixed' })
  })

  it('checks the files, the size and the account’s room before reading anything', async () => {
    const parse = parsing(10)
    expect(
      await refusal(
        Array.from({ length: 501 }, (_, i) => sized(`${i}.mp3`, 1)),
        { parse },
      ),
    ).toEqual({
      code: 'files',
    })
    const limits = { ...DEFAULT_LIMITS, userAudioBytes: 5000, audiobookBytes: 1000 }
    expect(await refusal([sized('a.m4b', 1001)], { parse, limits })).toEqual({ code: 'large', max: 1000 })
    expect(await refusal([sized('a.mp3', 500), sized('b.mp3', 501)], { parse, limits })).toEqual({
      code: 'large',
      max: 1000,
    })
    expect(await refusal([sized('a.m4b', 10)], { parse, limits, audioBytesUsed: 4991 })).toEqual({
      code: 'room',
      max: 5000,
    })
    expect(parse).not.toHaveBeenCalled()
  })

  it('refuses more than 1,000 chapters and a chapter over 24 hours', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ title: `${i}`, start: i }))
    expect(await refusal([fixture('chapter-1.mp3')], { parse: parsing(2000, many) })).toEqual({ code: 'chapters' })
    const files = [fixture('chapter-1.mp3', '1.mp3'), fixture('chapter-2.mp3', '2.mp3')]
    expect(await refusal(files, { parse: parsing(25 * 3600) })).toEqual({ code: 'long' })
  })

  it('says why a file couldn’t be read', async () => {
    const throwing = vi.fn(async () => {
      throw new Error('End-Of-Stream')
    }) as unknown as typeof parseBlob
    expect(await refusal([fixture('chapter-1.mp3')], { parse: throwing })).toEqual({
      code: 'unreadable',
      reason: 'End-Of-Stream',
    })
    expect(await refusal([fixture('chapter-1.mp3')], { parse: parsing(0.5) })).toEqual({
      code: 'unreadable',
      reason: 'its length couldn’t be read',
    })
  })

  it('names a file without tags by its name, splits it into parts, and stops when cancelled', async () => {
    const draft = await read([fixture('chapter-1.mp3', '01 - The Long Road.mp3')], { parse: parsing(7200) })
    expect(draft).toMatchObject({ title: 'The Long Road', author: '', narrator: '', language: 'en', from: 'parts' })
    expect(draft.chapters.map((c) => c.title)).toEqual(['Part 1', 'Part 2'])
    expect(draft.cover).toBeNull()
    const tagged = parsing(60, [], { comment: [{ text: 'Read in one sitting.' }], language: 'English!', year: 3000 })
    expect((await read([fixture('chapter-1.mp3')], { parse: tagged })).details).toEqual({
      description: 'Read in one sitting.',
      isbn: null,
      publisher: null,
      publishedYear: null,
    })
    let calls = 0
    const coverFails = vi.fn(async (file: Blob, options: object) => {
      if (++calls > 1) throw new Error('gone')
      return parseBlob(file, options)
    }) as unknown as typeof parseBlob
    expect((await read([fixture('chapter-1.mp3')], { parse: coverFails })).cover).toBeNull()
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(read([fixture('chapter-1.mp3')], { signal: cancelled.signal })).rejects.toThrow('Cancelled')
  })
})
