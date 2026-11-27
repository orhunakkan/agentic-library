import { describe, expect, it } from 'vitest'
import { foldText, matchesQuery } from '~/shared/lib/search'

describe('foldText', () => {
  it('lower-cases and strips Latin diacritics', () => {
    expect(foldText('Rubáiyát of Omar Khayyám')).toBe('rubaiyat of omar khayyam')
  })

  it('folds Turkish dotted and dotless i and the other Turkish letters', () => {
    expect(foldText('KIRIK İŞIK Çağ Söz Üç')).toBe('kirik isik cag soz uc')
  })

  it('folds circumflex vowels used in transliteration', () => {
    expect(foldText('Mûsâ Şuâlar')).toBe('musa sualar')
  })

  it('collapses whitespace and trims', () => {
    expect(foldText('  tao   te\tching ')).toBe('tao te ching')
  })

  it('treats precomposed and decomposed forms the same', () => {
    expect(foldText('Söz')).toBe(foldText('Söz'))
  })
})

describe('matchesQuery', () => {
  it('matches when every query word appears in some field', () => {
    expect(matchesQuery('rumi mystic', ['The Persian Mystics: Rúmí'])).toBe(true)
  })

  it('matches across fields', () => {
    expect(matchesQuery('stoic meditations', ['Meditations', 'Stoic Classics'])).toBe(true)
  })

  it('rejects when a word is missing', () => {
    expect(matchesQuery('emerson walden', ['Essays', 'Emerson'])).toBe(false)
  })

  it('an empty or blank query matches everything', () => {
    expect(matchesQuery('   ', ['Anything'])).toBe(true)
  })
})
