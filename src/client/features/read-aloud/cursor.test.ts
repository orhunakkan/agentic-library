import { describe, expect, it } from 'vitest'
import type { Utterance } from '~/shared/read-aloud/sentences'
import {
  atFraction,
  atOffset,
  CHARS_PER_SECOND,
  type Cursor,
  first,
  fraction,
  minutesLeft,
  next,
  onLastPage,
  type Plan,
  planChapter,
  prev,
  utteranceAt,
} from './cursor'

const u = (start: number, n: number): Utterance => ({ start, end: start + n, say: 'x'.repeat(n), kind: 'text' })

const plan: Plan = [[u(0, 10), u(20, 10)], [], [u(5, 20)]]
const at = (pageIndex: number, utteranceIndex: number): Cursor => ({ pageIndex, utteranceIndex })

describe('moving', () => {
  it('goes forward and back across pages, passing pages with nothing to say', () => {
    expect(first(plan)).toEqual(at(0, 0))
    expect(next(plan, at(0, 0))).toEqual(at(0, 1))
    expect(next(plan, at(0, 1))).toEqual(at(2, 0))
    expect(next(plan, at(2, 0))).toBeNull()
    expect(prev(plan, at(2, 0))).toEqual(at(0, 1))
    expect(prev(plan, at(0, 1))).toEqual(at(0, 0))
    expect(prev(plan, at(0, 0))).toBeNull()
    expect(first([[], []])).toBeNull()
  })

  it('knows the end of the chapter', () => {
    expect(onLastPage(plan, at(0, 1))).toBe(false)
    expect(onLastPage(plan, at(2, 0))).toBe(true)
    expect(utteranceAt(plan, at(2, 0))).toEqual(u(5, 20))
    expect(utteranceAt(plan, at(1, 0))).toBeNull()
  })
})

describe('atOffset', () => {
  it('finds the utterance containing an offset, or the next one', () => {
    expect(atOffset(plan, 0, 0)).toEqual(at(0, 0))
    expect(atOffset(plan, 0, 9)).toEqual(at(0, 0))
    expect(atOffset(plan, 0, 10)).toEqual(at(0, 1))
    expect(atOffset(plan, 0, 15)).toEqual(at(0, 1))
    expect(atOffset(plan, 0, 30)).toEqual(at(2, 0))
    expect(atOffset(plan, 1, 0)).toEqual(at(2, 0))
    expect(atOffset(plan, 2, 99)).toBeNull()
    expect(atOffset(plan, 7, 0)).toBeNull()
  })
})

describe('progress', () => {
  it('measures the chapter by characters said', () => {
    expect(fraction(plan, at(0, 0))).toBe(0)
    expect(fraction(plan, at(0, 1))).toBe(0.25)
    expect(fraction(plan, at(2, 0))).toBe(0.5)
    expect(fraction([[]], at(0, 0))).toBe(0)
  })

  it('seeks to the utterance at a fraction', () => {
    expect(atFraction(plan, 0)).toEqual(at(0, 0))
    expect(atFraction(plan, 0.24)).toEqual(at(0, 0))
    expect(atFraction(plan, 0.25)).toEqual(at(0, 1))
    expect(atFraction(plan, 0.6)).toEqual(at(2, 0))
    expect(atFraction(plan, 1)).toEqual(at(2, 0))
    expect(atFraction(plan, -3)).toEqual(at(0, 0))
    expect(atFraction([[]], 0.5)).toBeNull()
  })

  it('estimates the minutes left at 15 characters a second times the speed', () => {
    const long: Plan = [[u(0, CHARS_PER_SECOND * 60 * 14), u(0, 1)]]
    expect(minutesLeft(long, at(0, 0), 1)).toBe(15)
    expect(minutesLeft(long, at(0, 0), 2)).toBe(8)
    expect(minutesLeft(long, at(0, 0), 0.75)).toBe(19)
    expect(minutesLeft(long, at(0, 1), 1)).toBe(1)
  })
})

describe('planChapter', () => {
  it("splits each page into the book language's utterances", () => {
    const planned = planChapter(
      { pages: [{ text: 'One. Two.', blocks: [{ start: 0, end: 9, kind: 'text' }] }] } as never,
      'en',
    )
    expect(planned[0]?.map((x) => x.say)).toEqual(['One.', 'Two.'])
  })
})
