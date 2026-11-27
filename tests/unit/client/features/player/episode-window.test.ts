import { describe, expect, it } from 'vitest'
import {
  elementTime,
  endsInsideFile,
  isWindowed,
  needsSeek,
  reachedEnd,
  timeInEpisode,
} from '~/client/features/player/episode-window'

const file = '/account/books/b/audio/1'
const one = { audioUrl: file, startMs: 0, durationMs: 3000 }
const two = { audioUrl: file, startMs: 3000, durationMs: 3000 }
const last = { audioUrl: file, startMs: 6000, durationMs: 3046 }
const other = { audioUrl: '/account/books/b/audio/2', startMs: 0, durationMs: 5000 }
const catalogue = { audioUrl: '/audio/ep1.mp3', startMs: 0, durationMs: 484_000 }

describe('timeInEpisode and elementTime', () => {
  it('convert between the file’s time and the chapter’s, within the chapter', () => {
    expect(timeInEpisode(4500, two)).toBe(1500)
    expect(timeInEpisode(2000, two)).toBe(0)
    expect(timeInEpisode(9000, two)).toBe(3000)
    expect(elementTime(1500, two)).toBe(4500)
    expect(elementTime(-15_000, two)).toBe(3000)
    expect(elementTime(99_000, two)).toBe(6000)
    expect(timeInEpisode(12_000, catalogue)).toBe(12_000)
  })
})

describe('isWindowed', () => {
  it('is true for a chapter sharing its file, or starting inside it; false for a whole file', () => {
    expect(isWindowed([one, two, last], one)).toBe(true)
    expect(isWindowed([two], two)).toBe(true)
    expect(isWindowed([one, other], other)).toBe(false)
    expect(isWindowed([catalogue], catalogue)).toBe(false)
  })
})

describe('reachedEnd', () => {
  it('notices a chapter’s end a moment early, and not before', () => {
    expect(reachedEnd(5700, two)).toBe(false)
    expect(reachedEnd(5800, two)).toBe(true)
    expect(reachedEnd(6100, two)).toBe(true)
    expect(reachedEnd(9000, last)).toBe(true)
  })
})

describe('needsSeek', () => {
  it('runs straight on into the next chapter of the same file, and seeks otherwise', () => {
    expect(needsSeek(6000, two, last, 0)).toBe(false)
    expect(needsSeek(5900, two, last, 0)).toBe(false)
    expect(needsSeek(6000, two, last, 2000)).toBe(true)
    expect(needsSeek(4000, two, one, 0)).toBe(true)
    expect(needsSeek(6000, two, other, 0)).toBe(true)
    expect(needsSeek(0, null, one, 0)).toBe(true)
  })
})

describe('endsInsideFile', () => {
  it('is true when the next chapter is in the same file, false for a file’s last chapter or the book’s', () => {
    const book = [one, two, last, other]
    expect(endsInsideFile(book, one)).toBe(true)
    expect(endsInsideFile(book, two)).toBe(true)
    expect(endsInsideFile(book, last)).toBe(false)
    expect(endsInsideFile(book, other)).toBe(false)
    expect(endsInsideFile([one], two)).toBe(false)
  })
})
