import { describe, expect, it } from 'vitest'
import { locate, offsetOf, trimSpan } from '~/client/features/highlights/dom-text'

describe('locate', () => {
  const lengths = [6, 5, 0, 1]

  it('finds the node and offset of a page-text offset across many nodes', () => {
    expect(locate(lengths, 0, 'start')).toEqual({ index: 0, offset: 0 })
    expect(locate(lengths, 3, 'start')).toEqual({ index: 0, offset: 3 })
    expect(locate(lengths, 8, 'end')).toEqual({ index: 1, offset: 2 })
  })

  it('starts a range at the next node and ends it at the previous one on a node boundary', () => {
    expect(locate(lengths, 6, 'start')).toEqual({ index: 1, offset: 0 })
    expect(locate(lengths, 6, 'end')).toEqual({ index: 0, offset: 6 })
    expect(locate(lengths, 11, 'start')).toEqual({ index: 3, offset: 0 })
    expect(locate(lengths, 11, 'end')).toEqual({ index: 1, offset: 5 })
  })

  it('ends a range at the end of the last node, and finds nothing without nodes', () => {
    expect(locate(lengths, 12, 'end')).toEqual({ index: 3, offset: 1 })
    expect(locate(lengths, 12, 'start')).toEqual({ index: 3, offset: 1 })
    expect(locate([], 0, 'start')).toBeNull()
  })
})

describe('offsetOf', () => {
  it('adds the lengths of the nodes before, and clamps the offset to the node', () => {
    expect(offsetOf([6, 5, 0, 1], 0, 2)).toBe(2)
    expect(offsetOf([6, 5, 0, 1], 1, 5)).toBe(11)
    expect(offsetOf([6, 5, 0, 1], 3, 0)).toBe(11)
    expect(offsetOf([6, 5], 1, 99)).toBe(11)
  })

  it('round-trips with locate for every offset', () => {
    const lengths = [3, 0, 4, 1, 7]
    const total = lengths.reduce((a, b) => a + b, 0)
    for (let at = 0; at <= total; at++) {
      for (const side of ['start', 'end'] as const) {
        const point = locate(lengths, at, side)
        if (!point) throw new Error('no point')
        expect(offsetOf(lengths, point.index, point.offset)).toBe(at)
      }
    }
  })
})

describe('trimSpan', () => {
  it('trims whitespace at both ends, line breaks included', () => {
    expect(trimSpan('  a closure \n', 0, 13)).toEqual({ start: 2, end: 11 })
    expect(trimSpan('abc', 0, 3)).toEqual({ start: 0, end: 3 })
  })

  it('is null when only whitespace is selected', () => {
    expect(trimSpan('a   b', 1, 4)).toBeNull()
    expect(trimSpan('', 0, 0)).toBeNull()
  })
})
