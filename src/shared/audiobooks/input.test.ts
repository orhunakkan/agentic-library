import { describe, expect, it } from 'vitest'
import { parseAudiobookStart } from './input'
import { GB } from './limits'

/** The size of one audiobook the parser is given: the default, unless a test says otherwise. */
const MAX_BYTES = 2 * GB

const body = (over: Record<string, unknown> = {}) => ({
  title: '  The Fixture Audiobook ',
  author: 'Ada Fixture',
  narrator: 'Rex Reader',
  language: 'en',
  details: { description: 'Three chapters.', isbn: null, publisher: null, publishedYear: 2023 },
  files: [{ type: 'mp4', bytes: 36453 }],
  chapters: [
    { title: 'Opening', fileN: 1, startMs: 0, durationMs: 3000 },
    { title: 'Storm', fileN: 1, startMs: 3000, durationMs: 3000 },
  ],
  cover: true,
  ...over,
})

describe('parseAudiobookStart', () => {
  it('takes a well-formed start, cleaned', () => {
    expect(parseAudiobookStart(body(), MAX_BYTES)).toEqual({
      title: 'The Fixture Audiobook',
      author: 'Ada Fixture',
      narrator: 'Rex Reader',
      language: 'en',
      details: { description: 'Three chapters.', isbn: null, publisher: null, publishedYear: 2023 },
      type: 'mp4',
      files: [36453],
      chapters: [
        { title: 'Opening', fileN: 1, startMs: 0, durationMs: 3000 },
        { title: 'Storm', fileN: 1, startMs: 3000, durationMs: 3000 },
      ],
      cover: true,
    })
  })

  it('takes MP3s, a chapter each, and no narrator', () => {
    const parsed = parseAudiobookStart(
      body({
        narrator: undefined,
        files: [
          { type: 'mp3', bytes: 10 },
          { type: 'mp3', bytes: 20 },
        ],
        chapters: [
          { title: 'One', fileN: 1, startMs: 0, durationMs: 3000 },
          { title: 'Two', fileN: 2, startMs: 0, durationMs: 3000 },
        ],
      }),
      MAX_BYTES,
    )
    expect(parsed).toMatchObject({ type: 'mp3', files: [10, 20], narrator: null })
    expect(parseAudiobookStart(body({ narrator: '  ' }), MAX_BYTES)?.narrator).toBeNull()
    expect(parseAudiobookStart(body({ narrator: null }), MAX_BYTES)?.narrator).toBeNull()
  })

  it('refuses extra or missing fields, anywhere', () => {
    expect(parseAudiobookStart(body({ extra: 1 }), MAX_BYTES)).toBeNull()
    const { cover: _, ...noCover } = body()
    expect(parseAudiobookStart(noCover, MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ details: { colour: 'red' } }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ files: [{ type: 'mp4', bytes: 1, name: 'x' }] }), MAX_BYTES)).toBeNull()
    const chapter = { title: 'A', fileN: 1, startMs: 0, durationMs: 10, extra: true }
    expect(parseAudiobookStart(body({ chapters: [chapter] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(null, MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart([], MAX_BYTES)).toBeNull()
  })

  it('checks each field', () => {
    for (const over of [
      { title: '' },
      { title: 'x'.repeat(301) },
      { author: ' ' },
      { author: 7 },
      { narrator: 'n'.repeat(201) },
      { narrator: 3 },
      { language: 'english' },
      { cover: 'yes' },
      { details: { isbn: '123' } },
      { details: { publishedYear: 3000 } },
      { details: 'none' },
    ])
      expect(parseAudiobookStart(body(over), MAX_BYTES), JSON.stringify(over)).toBeNull()
  })

  it('holds one audiobook to the size it is given, for one M4B and for MP3s in total', () => {
    const mp3 = (bytes: number) => ({ type: 'mp3', bytes })
    const two = [
      { title: 'a', fileN: 1, startMs: 0, durationMs: 1 },
      { title: 'b', fileN: 2, startMs: 0, durationMs: 1 },
    ]
    const m4b = (bytes: number) => body({ files: [{ type: 'mp4', bytes }] })
    expect(parseAudiobookStart(m4b(1000), 1000)?.files).toEqual([1000])
    expect(parseAudiobookStart(m4b(1001), 1000)).toBeNull()
    expect(parseAudiobookStart(body({ files: [mp3(500), mp3(500)], chapters: two }), 1000)?.files).toEqual([500, 500])
    expect(parseAudiobookStart(body({ files: [mp3(500), mp3(501)], chapters: two }), 1000)).toBeNull()
  })

  it('wants one M4B or MP3s of one kind, within the sizes', () => {
    const mp3 = (bytes: number) => ({ type: 'mp3', bytes })
    const tiled = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ title: 'c', fileN: i + 1, startMs: 0, durationMs: 1 }))
    expect(parseAudiobookStart(body({ files: [] }), MAX_BYTES)).toBeNull()
    expect(
      parseAudiobookStart(
        body({
          files: [
            { type: 'mp4', bytes: 1 },
            { type: 'mp4', bytes: 1 },
          ],
          chapters: tiled(2),
        }),
        MAX_BYTES,
      ),
    ).toBeNull()
    expect(
      parseAudiobookStart(body({ files: [mp3(1), { type: 'mp4', bytes: 1 }], chapters: tiled(2) }), MAX_BYTES),
    ).toBeNull()
    expect(parseAudiobookStart(body({ files: [{ type: 'ogg', bytes: 1 }] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ files: [{ type: 'mp4', bytes: 0 }] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ files: [{ type: 'mp4', bytes: 1.5 }] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ files: [mp3(GB), mp3(GB), mp3(1)], chapters: tiled(3) }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ files: [mp3(GB), mp3(GB)], chapters: tiled(2) }), MAX_BYTES)).not.toBeNull()
    expect(
      parseAudiobookStart(body({ files: Array.from({ length: 501 }, () => mp3(1)), chapters: tiled(501) }), MAX_BYTES),
    ).toBeNull()
    expect(
      parseAudiobookStart(body({ files: Array.from({ length: 500 }, () => mp3(1)), chapters: tiled(500) }), MAX_BYTES),
    ).not.toBeNull()
  })

  it('wants chapters that tile their files, none past its file', () => {
    const c = (fileN: number, startMs: number, durationMs: number, title = 'c') => ({
      title,
      fileN,
      startMs,
      durationMs,
    })
    expect(parseAudiobookStart(body({ chapters: [] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ chapters: [c(2, 0, 10)] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ chapters: [c(1, 0, 10), c(1, 20, 10)] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ chapters: [c(1, 0, 0)] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ chapters: [c(1, 0, 86_400_001)] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ chapters: [c(1, -1, 10)] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ chapters: [c(1, 0, 10, '\u0007 ')] }), MAX_BYTES)).toBeNull()
    expect(parseAudiobookStart(body({ chapters: [c(1, 0, 10, 'x'.repeat(601))] }), MAX_BYTES)).toBeNull()
    expect(
      parseAudiobookStart(body({ chapters: Array.from({ length: 1001 }, (_, i) => c(1, i, 1)) }), MAX_BYTES),
    ).toBeNull()
    expect(
      parseAudiobookStart(body({ chapters: Array.from({ length: 1000 }, (_, i) => c(1, i, 1)) }), MAX_BYTES),
    ).not.toBeNull()
  })
})
