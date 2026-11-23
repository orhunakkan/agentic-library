import { describe, expect, it } from 'vitest'
import { servedBooks } from '../../../tests/fixtures/served-books'
import { type Alignment, sayMap, wordsFrom } from './alignment.ts'
import { CODE_SAY, utterances } from './sentences.ts'
import { chapterPageBlocks, pagedPageBlocks, type SpeechPageText } from './speech-text.ts'

function evenly(text: string, step = 0.1): Alignment {
  const characters = [...text]
  return {
    characters,
    starts: characters.map((_, i) => i * step),
    ends: characters.map((_, i) => (i + 1) * step),
  }
}

describe('sayMap over every page the app serves', () => {
  it('builds exactly the say of every utterance, with offsets inside its span', () => {
    let checked = 0
    for (const { file, book } of servedBooks()) {
      const pages: SpeechPageText[] =
        book.kind === 'chapter'
          ? book.chapters.flatMap((c) => c.pages.map(chapterPageBlocks))
          : book.pages.map((p) => pagedPageBlocks(p.blocks))
      for (const [i, page] of pages.entries()) {
        for (const u of utterances(page, 'en')) {
          if (u.say === CODE_SAY && u.kind === 'code') continue
          const map = sayMap(page.text, u.start, u.end)
          expect(map.say, `${file} page ${i}`).toBe(u.say)
          expect(map.offsets).toHaveLength(map.say.length)
          expect(map.offsets.every((o) => o >= u.start && o < u.end)).toBe(true)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(3000)
  })
})

describe('sayMap', () => {
  it('collapses runs of whitespace, U+00A0 included, to one space and trims both ends', () => {
    const text = 'xx  It  is\n\ttrue.  yy'
    const map = sayMap(text, 2, 19)
    expect(map.say).toBe('It is true.')
    expect(map.offsets).toEqual([4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 16])
  })

  it('gives nothing for a span of whitespace', () => {
    expect(sayMap('a   b', 1, 4)).toEqual({ say: '', offsets: [] })
  })
})

describe('wordsFrom', () => {
  it('gives each word its page span and its time in ms', () => {
    const text = '  It  is true.'
    const map = sayMap(text, 0, text.length)
    expect(map.say).toBe('It is true.')
    expect(wordsFrom(map, evenly(map.say))).toEqual([
      { start: 2, end: 4, t0: 0, t1: 200 },
      { start: 6, end: 8, t0: 300, t1: 500 },
      { start: 9, end: 14, t0: 600, t1: 1100 },
    ])
  })

  it('gives one word for a one-word utterance', () => {
    const map = sayMap('Yes!', 0, 4)
    expect(wordsFrom(map, evenly('Yes!', 0.25))).toEqual([{ start: 0, end: 4, t0: 0, t1: 1000 }])
  })

  it('gives no words when the alignment doesn’t spell what was said, or there is none', () => {
    const map = sayMap('It costs 12 pounds.', 0, 19)
    expect(wordsFrom(map, evenly('It costs twelve pounds.'))).toEqual([])
    expect(wordsFrom(map, null)).toEqual([])
  })

  it('keeps a character ElevenLabs gives as a surrogate pair together', () => {
    const text = 'Go 🚀 now'
    const map = sayMap(text, 0, text.length)
    const words = wordsFrom(map, evenly(map.say))
    expect(words.map((w) => text.slice(w.start, w.end))).toEqual(['Go', '🚀', 'now'])
    expect(words[1]).toMatchObject({ t0: 300, t1: 400 })
    expect(words[2]).toMatchObject({ t0: 500, t1: 800 })
  })

  it('never gives a negative time', () => {
    const map = sayMap('Hi', 0, 2)
    expect(wordsFrom(map, { characters: ['H', 'i'], starts: [-0.01, 0.1], ends: [0.1, 0.2] })).toEqual([
      { start: 0, end: 2, t0: 0, t1: 200 },
    ])
  })
})
