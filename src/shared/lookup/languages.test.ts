import { describe, expect, it } from 'vitest'
import {
  defaultTarget,
  englishName,
  isTranslateLanguage,
  languageLabel,
  primaryLanguage,
  TRANSLATE_LANGUAGES,
  translateOptions,
} from './languages'

describe('primaryLanguage', () => {
  it('is the primary subtag in lower case, or en for anything that isn’t a language', () => {
    expect(primaryLanguage('en-GB')).toBe('en')
    expect(primaryLanguage('EN')).toBe('en')
    expect(primaryLanguage('fr_CA')).toBe('fr')
    expect(primaryLanguage('haw')).toBe('haw')
    expect(primaryLanguage('x-klingon')).toBe('en')
    expect(primaryLanguage('')).toBe('en')
    expect(primaryLanguage(null)).toBe('en')
    expect(primaryLanguage('../etc')).toBe('en')
  })
})

describe('defaultTarget', () => {
  it('takes the first browser language in the list that isn’t the book’s', () => {
    expect(defaultTarget(['en-GB', 'tr-TR', 'de'], 'en')).toBe('tr')
    expect(defaultTarget(['tr'], 'en-US')).toBe('tr')
    expect(defaultTarget(['en-US', 'en'], 'fr')).toBe('en')
  })

  it('skips languages that aren’t in the list', () => {
    expect(defaultTarget(['cy', 'ga', 'it'], 'en')).toBe('it')
  })

  it('picks the Chinese script by region', () => {
    expect(defaultTarget(['zh-TW'], 'en')).toBe('zh-Hant')
    expect(defaultTarget(['zh-HK'], 'en')).toBe('zh-Hant')
    expect(defaultTarget(['zh-Hant-SG'], 'en')).toBe('zh-Hant')
    expect(defaultTarget(['zh-CN'], 'en')).toBe('zh-Hans')
    expect(defaultTarget(['zh'], 'en')).toBe('zh-Hans')
    expect(defaultTarget(['zh-CN'], 'zh')).toBeNull()
  })

  it('is null when nothing fits', () => {
    expect(defaultTarget(['en-GB', 'en'], 'en')).toBeNull()
    expect(defaultTarget([], 'en')).toBeNull()
  })
})

describe('the list', () => {
  it('knows its codes', () => {
    expect(isTranslateLanguage('tr')).toBe(true)
    expect(isTranslateLanguage('zh-Hant')).toBe(true)
    expect(isTranslateLanguage('zh')).toBe(false)
    expect(isTranslateLanguage(1)).toBe(false)
  })

  it('labels each with its English name and its own', () => {
    expect(languageLabel('tr')).toBe('Turkish · Türkçe')
    expect(languageLabel('en')).toBe('English')
    expect(languageLabel('zh-Hans')).toBe('Simplified Chinese · 简体中文')
    expect(englishName('fr')).toBe('French')
  })

  it('sorts the options by English name', () => {
    const options = translateOptions()
    expect(options).toHaveLength(TRANSLATE_LANGUAGES.length)
    expect(options[0]?.label).toMatch(/^Arabic/)
    const names = options.map((o) => o.label)
    expect([...names].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(names)
  })
})
