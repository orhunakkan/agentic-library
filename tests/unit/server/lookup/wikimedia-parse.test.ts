import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  cutExtract,
  DEFINITION_MAX,
  EXTRACT_MAX,
  htmlToText,
  MAX_DEFINITIONS,
  MAX_PARTS,
  parseDefinition,
  parseSummary,
} from '~/server/lookup/wikimedia-parse'

const saved = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../stubs/wikimedia/${name}.json`, import.meta.url), 'utf8')) as unknown

const definition = (text: string) => ({ definition: text })
const section = (partOfSpeech: string, ...texts: string[]) => ({
  partOfSpeech,
  language: 'English',
  definitions: texts.map(definition),
})

describe('parseDefinition', () => {
  it('reads an English verb and noun as plain text, links and labels removed', () => {
    const entry = parseDefinition(saved('definition-entail'), 'en')
    expect(entry).toMatchObject({ language: 'en', languageName: 'English', otherLanguage: false })
    expect(entry?.senses.map((s) => s.partOfSpeech)).toEqual(['Verb', 'Noun'])
    expect(entry?.senses[0]?.definitions[0]).toEqual({ text: 'To imply, require, or invoke.' })
    expect(entry?.senses[1]?.definitions[0]?.text).toBe('That which is entailed.')
    expect(entry?.senses[1]?.definitions).toHaveLength(MAX_DEFINITIONS)
  })

  it('gives a form of another word its lemma', () => {
    const entry = parseDefinition(saved('definition-entailed'), 'en')
    const verb = entry?.senses.find((s) => s.partOfSpeech === 'Verb')
    expect(verb?.definitions[0]).toEqual({ text: 'simple past and past participle of entail', lemma: 'entail' })
    expect(entry?.senses[0]?.definitions[0]?.lemma).toBeUndefined()
    const acknowledged = parseDefinition(saved('definition-acknowledged'), 'en')
    expect(acknowledged?.senses[1]?.definitions.map((d) => d.lemma)).toEqual(['acknowledg', 'acknowledge'])
  })

  it('falls back to the first other language, labelled, when the book’s has no entries', () => {
    expect(parseDefinition(saved('definition-bientot'), 'en')).toEqual({
      language: 'fr',
      languageName: 'French',
      otherLanguage: true,
      senses: [{ partOfSpeech: 'Adverb', definitions: [{ text: 'soon' }] }],
    })
    const chaise = parseDefinition(saved('definition-chaise'), 'fr')
    expect(chaise).toMatchObject({ language: 'fr', otherLanguage: false })
    expect(chaise?.senses[0]?.definitions[0]?.text).toBe('chair, seat')
  })

  it('caps the parts of speech, the definitions and their length, and merges a part of speech that repeats', () => {
    const long = 'word '.repeat(200)
    const json = {
      en: [
        section('Noun', 'one', 'two'),
        section('Verb', long),
        section('Noun', 'three', 'four', 'five'),
        section('Adjective', 'kept'),
        section('Adverb', 'dropped'),
      ],
    }
    const entry = parseDefinition(json, 'en')
    expect(entry?.senses.map((s) => s.partOfSpeech)).toEqual(['Noun', 'Verb', 'Adjective'])
    expect(entry?.senses).toHaveLength(MAX_PARTS)
    expect(entry?.senses[0]?.definitions.map((d) => d.text)).toEqual(['one', 'two', 'three', 'four'])
    const cut = entry?.senses[1]?.definitions[0]?.text ?? ''
    expect([...cut].length).toBeLessThanOrEqual(DEFINITION_MAX)
    expect(cut.endsWith('word…')).toBe(true)
  })

  it('reduces hostile HTML to text', () => {
    const json = {
      en: [
        section(
          'Noun',
          '<script>alert(1)</script>A <img src=x onerror="alert(2)">thing &amp; <b>more</b> &lt;b&gt;',
          '<style>p{}</style>',
        ),
      ],
    }
    expect(parseDefinition(json, 'en')?.senses).toEqual([
      { partOfSpeech: 'Noun', definitions: [{ text: 'A thing & more <b>' }] },
    ])
    expect(htmlToText('<a href="/wiki/x" title="x">x</a>\n\n y')).toBe('x y')
  })

  it('drops a lemma no one could look up', () => {
    const html = '<span class="form-of-definition-link"><a title="1813">1813</a></span>'
    expect(parseDefinition({ en: [section('Verb', html)] }, 'en')?.senses[0]?.definitions[0]).toEqual({ text: '1813' })
  })

  it('is null for anything that isn’t the expected shape', () => {
    expect(parseDefinition(null, 'en')).toBeNull()
    expect(parseDefinition([], 'en')).toBeNull()
    expect(parseDefinition({ status: 404, type: 'Internal error' }, 'en')).toBeNull()
    expect(parseDefinition({ en: 'text' }, 'en')).toBeNull()
    expect(parseDefinition({ en: [{ partOfSpeech: 1 }, 'x', { partOfSpeech: '', definitions: [] }] }, 'en')).toBeNull()
    expect(parseDefinition({ en: [section('Noun', '', '  ')] }, 'en')).toBeNull()
    expect(parseDefinition({ en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 3 }, null] }] }, 'en')).toBeNull()
    expect(parseDefinition({ 'not a code!': [section('Noun', 'x')] }, 'en')).toBeNull()
  })

  it('names a language from its code when the section doesn’t', () => {
    const json = { de: [{ partOfSpeech: 'Noun', definitions: [definition('house')] }] }
    expect(parseDefinition(json, 'en')).toMatchObject({ language: 'de', languageName: 'German' })
  })
})

describe('parseSummary', () => {
  it('reads an article’s title, description, extract and address', () => {
    expect(parseSummary(saved('summary-hertfordshire'), 'en')).toEqual({
      kind: 'found',
      title: 'Hertfordshire',
      description: 'County of England',
      extract: expect.stringMatching(/^Hertfordshire is a ceremonial county in the East of England\./),
      url: 'https://en.wikipedia.org/wiki/Hertfordshire',
    })
  })

  it('reads a disambiguation page as ambiguous', () => {
    expect(parseSummary(saved('summary-bennet'), 'en')).toEqual({
      kind: 'ambiguous',
      title: 'Bennet',
      url: 'https://en.wikipedia.org/wiki/Bennet',
    })
  })

  it('reads another language’s Wikipedia', () => {
    expect(parseSummary(saved('summary-fr-paris'), 'fr')).toMatchObject({ kind: 'found', title: 'Paris' })
  })

  it('has no description when there is none', () => {
    const json = { type: 'standard', title: 'X', extract: 'X is.', content_urls: { desktop: { page: 'https://x' } } }
    expect(parseSummary(json, 'en')).toMatchObject({ description: null })
  })

  it('is null for anything else', () => {
    const page = { content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/X' } } }
    expect(parseSummary(null, 'en')).toBeNull()
    expect(parseSummary({ ...page, type: 'standard', title: 'X' }, 'en')).toBeNull()
    expect(parseSummary({ ...page, type: 'standard', title: 'X', extract: ' ' }, 'en')).toBeNull()
    expect(parseSummary({ ...page, type: 'mainpage', title: 'X', extract: 'x' }, 'en')).toBeNull()
    expect(parseSummary({ type: 'standard', title: 'X', extract: 'x' }, 'en')).toBeNull()
    const script = { content_urls: { desktop: { page: 'javascript:alert(1)' } } }
    expect(parseSummary({ ...script, type: 'standard', title: 'X', extract: 'x' }, 'en')).toBeNull()
    expect(parseSummary({ ...page, type: 'standard', title: '', extract: 'x' }, 'en')).toBeNull()
  })
})

describe('cutExtract', () => {
  it('keeps a short extract, whitespace collapsed', () => {
    expect(cutExtract(' One.\n Two. ', 'en')).toBe('One. Two.')
  })

  it('cuts at the last sentence end within 1,200 characters', () => {
    const sentence = `Word ${'word '.repeat(18)}end. `
    const cut = cutExtract(sentence.repeat(20), 'en')
    expect(cut.length).toBeLessThanOrEqual(EXTRACT_MAX)
    expect(cut.endsWith('end.')).toBe(true)
  })

  it('cuts at a space with … when the first sentence is longer than that', () => {
    const cut = cutExtract(`${'word '.repeat(300)}end.`, 'en')
    expect([...cut].length).toBeLessThanOrEqual(EXTRACT_MAX)
    expect(cut.endsWith('word…')).toBe(true)
  })
})
