import { describe, expect, it } from 'vitest'
import {
  buildChapters,
  chaptersTile,
  cleanTitle,
  type FileReading,
  fitToFiles,
  formatLength,
  totalMs,
} from './chapters'

const MIN = 60_000
const HOUR = 60 * MIN
const file = (durationMs: number, chapters: FileReading['chapters'] = [], title = 'A file'): FileReading => ({
  durationMs,
  chapters,
  title,
})

describe('buildChapters', () => {
  it('takes one file’s own chapters as windows, the first from 0 and the last to the end', () => {
    const built = buildChapters([
      file(9000, [
        { title: 'Two', startMs: 3000 },
        { title: 'One', startMs: 40 },
        { title: 'Three', startMs: 6000 },
      ]),
    ])
    expect(built).toEqual({
      ok: true,
      from: 'file',
      chapters: [
        { title: 'One', fileN: 1, startMs: 0, durationMs: 3000 },
        { title: 'Two', fileN: 1, startMs: 3000, durationMs: 3000 },
        { title: 'Three', fileN: 1, startMs: 6000, durationMs: 3000 },
      ],
    })
  })

  it('drops marks at the same moment or past the end', () => {
    const built = buildChapters([
      file(5000, [
        { title: 'A', startMs: 0 },
        { title: 'Again', startMs: 0 },
        { title: 'B', startMs: 2000 },
        { title: 'Past', startMs: 5000 },
      ]),
    ])
    expect(built.ok && built.chapters.map((c) => [c.title, c.durationMs])).toEqual([
      ['A', 2000],
      ['B', 3000],
    ])
  })

  it('takes an MP3’s ID3 chapters the same way', () => {
    const built = buildChapters([file(4000, [{ title: 'Only', startMs: 0 }])])
    expect(built.ok && built.from).toBe('file')
  })

  it('makes one chapter per MP3, titled by the file', () => {
    const built = buildChapters([file(3000, [], 'The Arrival'), file(4000, [{ title: 'ignored', startMs: 0 }], '')])
    expect(built).toEqual({
      ok: true,
      from: 'files',
      chapters: [
        { title: 'The Arrival', fileN: 1, startMs: 0, durationMs: 3000 },
        { title: 'Chapter 2', fileN: 2, startMs: 0, durationMs: 4000 },
      ],
    })
  })

  it('splits a file without chapters into hours: 2 h 10 min is three parts', () => {
    const built = buildChapters([file(2 * HOUR + 10 * MIN)])
    expect(built).toEqual({
      ok: true,
      from: 'parts',
      chapters: [
        { title: 'Part 1', fileN: 1, startMs: 0, durationMs: HOUR },
        { title: 'Part 2', fileN: 1, startMs: HOUR, durationMs: HOUR },
        { title: 'Part 3', fileN: 1, startMs: 2 * HOUR, durationMs: 10 * MIN },
      ],
    })
    expect(buildChapters([file(30 * MIN)]).ok && buildChapters([file(30 * MIN)])).toMatchObject({
      chapters: [{ title: 'Part 1', durationMs: 30 * MIN }],
    })
  })

  it('names empty titles and cleans the rest', () => {
    const built = buildChapters([
      file(4000, [
        { title: '  ', startMs: 0 },
        { title: 'Café\u0007  Royal', startMs: 2000 },
      ]),
    ])
    expect(built.ok && built.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Café Royal'])
  })

  it('refuses a chapter over 24 hours and more than 1,000 chapters', () => {
    expect(buildChapters([file(25 * HOUR, [], 'Long'), file(1000)])).toEqual({ ok: false, problem: 'long' })
    expect(buildChapters([file(25 * HOUR, [{ title: 'All', startMs: 0 }])])).toEqual({ ok: false, problem: 'long' })
    const many = Array.from({ length: 1001 }, (_, i) => ({ title: `${i}`, startMs: i * 1000 }))
    expect(buildChapters([file(1_001_000, many)])).toEqual({ ok: false, problem: 'chapters' })
    expect(buildChapters(Array.from({ length: 1000 }, () => file(1000))).ok).toBe(true)
  })
})

describe('cleanTitle', () => {
  it('is NFC, without control characters, on one line, at most 300 characters', () => {
    expect(cleanTitle(' a\n\tb ')).toBe('a b')
    expect(cleanTitle('x'.repeat(400))).toHaveLength(300)
  })
})

describe('chaptersTile', () => {
  const c = (fileN: number, startMs: number, durationMs: number) => ({ title: 't', fileN, startMs, durationMs })

  it('wants every file in order, each from 0 and without gaps', () => {
    expect(chaptersTile([c(1, 0, 10), c(1, 10, 5), c(2, 0, 3)], 2)).toBe(true)
    expect(chaptersTile([c(1, 0, 10), c(1, 11, 5)], 1)).toBe(false)
    expect(chaptersTile([c(1, 5, 10)], 1)).toBe(false)
    expect(chaptersTile([c(2, 0, 10), c(1, 0, 5)], 2)).toBe(false)
    expect(chaptersTile([c(1, 0, 10)], 2)).toBe(false)
    expect(chaptersTile([c(1, 0, 10), c(3, 0, 1)], 3)).toBe(false)
  })
})

describe('fitToFiles', () => {
  const c = (fileN: number, startMs: number, durationMs: number) => ({ title: 't', fileN, startMs, durationMs })

  it('ends each file’s last chapter at the file’s end, as the server read it', () => {
    expect(fitToFiles([c(1, 0, 3000), c(1, 3000, 3000), c(2, 0, 3000)], [6056, 3100])).toEqual([
      c(1, 0, 3000),
      c(1, 3000, 3056),
      c(2, 0, 3100),
    ])
  })

  it('refuses a chapter that starts past its file’s end, or would run past 24 hours', () => {
    expect(fitToFiles([c(1, 0, 3000), c(1, 3000, 3000)], [2500])).toBeNull()
    expect(fitToFiles([c(1, 0, 1000)], [25 * HOUR])).toBeNull()
    expect(fitToFiles([c(1, 0, 1000)], [])).toBeNull()
  })
})

describe('totalMs and formatLength', () => {
  it('adds the chapters up and says it as the page does', () => {
    expect(totalMs([c(3000), c(4000)])).toBe(7000)
    expect(formatLength(3056)).toBe('3 s')
    expect(formatLength(200)).toBe('1 s')
    expect(formatLength(59_900)).toBe('59 s')
    expect(formatLength(12 * MIN)).toBe('12 min')
    expect(formatLength(HOUR + 4 * MIN)).toBe('1 h 4 min')
    expect(formatLength(11 * HOUR + 32 * MIN)).toBe('11 h 32 min')
    expect(formatLength(2 * HOUR)).toBe('2 h')
  })
  function c(durationMs: number) {
    return { durationMs }
  }
})
