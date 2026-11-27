import { describe, expect, it } from 'vitest'
import { chooseCandidate, parseSrcset } from '~/shared/articles/srcset'

describe('parseSrcset', () => {
  it('reads widths and densities', () => {
    expect(parseSrcset('a.jpg 400w, b.jpg 800w')).toEqual([
      { url: 'a.jpg', width: 400, density: null },
      { url: 'b.jpg', width: 800, density: null },
    ])
    expect(parseSrcset('a.jpg, b.jpg 2x')).toEqual([
      { url: 'a.jpg', width: null, density: 1 },
      { url: 'b.jpg', width: null, density: 2 },
    ])
  })
  it('keeps a URL with commas in it whole', () => {
    expect(parseSrcset('https://cdn.test/w_400,h_300/a.jpg 400w,https://cdn.test/w_800,h_600/a.jpg 800w')).toEqual([
      { url: 'https://cdn.test/w_400,h_300/a.jpg', width: 400, density: null },
      { url: 'https://cdn.test/w_800,h_600/a.jpg', width: 800, density: null },
    ])
  })
  it('ignores junk', () => {
    expect(parseSrcset('')).toEqual([])
    expect(parseSrcset(' , ,')).toEqual([])
    expect(parseSrcset('a.jpg,,, b.jpg 10q')).toEqual([
      { url: 'a.jpg', width: null, density: 1 },
      { url: 'b.jpg', width: null, density: 1 },
    ])
  })
})

describe('chooseCandidate', () => {
  it('takes the widest at most 1,600, else the narrowest', () => {
    expect(chooseCandidate(parseSrcset('s.jpg 400w, m.jpg 1600w, l.jpg 2400w'))).toBe('m.jpg')
    expect(chooseCandidate(parseSrcset('l.jpg 2400w, xl.jpg 3200w'))).toBe('l.jpg')
  })
  it('takes the highest density at most 2×, else the lowest', () => {
    expect(chooseCandidate(parseSrcset('a.jpg, b.jpg 2x, c.jpg 3x'))).toBe('b.jpg')
    expect(chooseCandidate(parseSrcset('c.jpg 3x, d.jpg 4x'))).toBe('c.jpg')
  })
  it('is null for nothing', () => expect(chooseCandidate([])).toBeNull())
})
