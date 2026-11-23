import { describe, expect, it } from 'vitest'
import { type PiperPhonemeConfig, phonemeIds, sentences, splitPhonemes, textPhonemes } from './phonemes'

const CORI: PiperPhonemeConfig = {
  phoneme_id_map: {
    _: [0],
    '^': [1],
    $: [2],
    ' ': [3],
    ',': [8],
    '.': [10],
    '?': [13],
    a: [14],
    b: [15],
    d: [17],
    e: [18],
    h: [20],
    i: [21],
    j: [22],
    m: [25],
    n: [26],
    o: [27],
    s: [31],
    t: [32],
    u: [33],
    v: [34],
    æ: [39],
    ɐ: [50],
    ɔ: [54],
    ə: [59],
    ɛ: [61],
    ɜ: [62],
    ɪ: [74],
    ʊ: [100],
    ˈ: [120],
    ː: [122],
    aɪ: [161],
  },
  vowel_clusters: [
    ['a', 'ɪ'],
    ['a', 'ʊ'],
    ['e', 'ɪ'],
    ['o', 'ʊ'],
    ['ɔ', 'ɪ'],
  ],
}

describe('the fixture sentence', () => {
  it('gives the ids Piper’s Python gives (piper-tts 1.8.0, Cori)', () => {
    const raw = 'maɪ dˈiə mˈɪstɐ.bˈɛnɪt, hæv juː hˈɜːd?'
    const ids = sentences(splitPhonemes(raw, CORI)).map((s) => phonemeIds(s, CORI))
    expect(ids).toEqual([
      [
        1, 0, 25, 0, 161, 0, 3, 0, 17, 0, 120, 0, 21, 0, 59, 0, 3, 0, 25, 0, 120, 0, 74, 0, 31, 0, 32, 0, 50, 0, 10, 0,
        2,
      ],
      [
        1, 0, 15, 0, 120, 0, 61, 0, 26, 0, 74, 0, 32, 0, 8, 0, 3, 0, 20, 0, 39, 0, 34, 0, 3, 0, 22, 0, 33, 0, 122, 0, 3,
        0, 20, 0, 120, 0, 62, 0, 122, 0, 17, 0, 13, 0, 2,
      ],
    ])
  })
})

describe('phonemeIds', () => {
  it('wraps the phonemes in BOS and EOS with pad between', () => {
    expect(phonemeIds(['m', 'aɪ'], CORI)).toEqual([1, 0, 25, 0, 161, 0, 2])
    expect(phonemeIds([], CORI)).toEqual([1, 0, 2])
  })

  it('drops a phoneme the map lacks', () => {
    expect(phonemeIds(['m', 'ʒ', 'aɪ'], CORI)).toEqual([1, 0, 25, 0, 161, 0, 2])
  })
})

describe('splitPhonemes', () => {
  it('decomposes, drops language flags and merges vowel clusters', () => {
    expect(splitPhonemes('(fr)bɔ̃(en)aɪ', CORI)).toEqual(['b', 'ɔ', '̃', 'aɪ'])
    expect(splitPhonemes('eɪoʊx', CORI)).toEqual(['eɪ', 'oʊ', 'x'])
  })

  it('keeps code points as they are without clusters', () => {
    expect(splitPhonemes('aɪ', { phoneme_id_map: {} })).toEqual(['a', 'ɪ'])
  })
})

describe('sentences', () => {
  it('cuts after a terminator something follows', () => {
    expect(sentences(['a', '.', 'b', '?'])).toEqual([
      ['a', '.'],
      ['b', '?'],
    ])
    expect(sentences(['a', '.', ' ', 'b'])).toEqual([['a', '.'], ['b']])
    expect(sentences(['a', '!'])).toEqual([['a', '!']])
    expect(sentences([' '])).toEqual([])
  })
})

describe('textPhonemes', () => {
  it('lower-cases and decomposes, so й is и and a breve', () => {
    expect(textPhonemes('Йо')).toEqual(['и', '̆', 'о'])
  })
})
