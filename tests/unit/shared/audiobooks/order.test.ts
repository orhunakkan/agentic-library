import { describe, expect, it } from 'vitest'
import { playOrder, titleFromFileName } from '~/shared/audiobooks/order'

describe('playOrder', () => {
  it('goes by disc, then track, then name', () => {
    const files = [
      { name: 'b.mp3', disc: 2, track: 1 },
      { name: 'z.mp3', disc: 1, track: 2 },
      { name: 'a.mp3', disc: 1, track: 1 },
      { name: 'c.mp3', disc: null, track: 3 },
    ]
    expect(playOrder(files)).toEqual([2, 1, 3, 0])
  })

  it('uses the names in natural order when any file lacks a track number', () => {
    const files = [
      { name: 'Part 10.mp3', disc: null, track: 1 },
      { name: 'Part 2.mp3', disc: null, track: null },
      { name: 'part 1.mp3', disc: null, track: 3 },
    ]
    expect(playOrder(files)).toEqual([2, 1, 0])
  })

  it('keeps the picked order for files that tie', () => {
    expect(
      playOrder([
        { name: 'a.mp3', disc: null, track: 1 },
        { name: 'a.mp3', disc: null, track: 1 },
      ]),
    ).toEqual([0, 1])
  })
})

describe('titleFromFileName', () => {
  it('drops the extension and a leading track number', () => {
    expect(titleFromFileName('01 - Title.mp3')).toBe('Title')
    expect(titleFromFileName('3. The Storm.m4b')).toBe('The Storm')
    expect(titleFromFileName('12_the_end.mp3')).toBe('the end')
    expect(titleFromFileName('Chapter Two.mp3')).toBe('Chapter Two')
    expect(titleFromFileName('folder/1984.mp3')).toBe('1984')
    expect(titleFromFileName('07 - .mp3')).toBe('07 -')
  })
})
