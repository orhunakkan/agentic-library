import { describe, expect, it } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { parseTranslateInput, parseWordInput } from './input'

const BOOK = 'pride-and-prejudice'
const PRIVATE = privateBookSlug('0b5e8d4c-3f7a-4e1b-9c2d-6a8f0e1b2c3d')

describe('parseWordInput', () => {
  it('takes a catalogue or private book, a term and a source, with the term normalised', () => {
    expect(parseWordInput({ book: BOOK, term: '“Entailed,”', source: 'dictionary' })).toEqual({
      book: BOOK,
      term: 'Entailed',
      source: 'dictionary',
    })
    expect(parseWordInput({ book: PRIVATE, term: 'Lucas  Lodge', source: 'wikipedia' })).toMatchObject({
      term: 'Lucas Lodge',
    })
  })

  it('refuses unknown fields, a bad book, a bad source and a missing field', () => {
    expect(parseWordInput({ book: BOOK, term: 'x', source: 'dictionary', extra: 1 })).toBeNull()
    expect(parseWordInput({ book: 'u-not-a-uuid', term: 'chaise', source: 'dictionary' })).toBeNull()
    expect(parseWordInput({ book: '../etc', term: 'chaise', source: 'dictionary' })).toBeNull()
    expect(parseWordInput({ book: BOOK, term: 'chaise', source: 'oxford' })).toBeNull()
    expect(parseWordInput({ book: BOOK, source: 'dictionary' })).toBeNull()
    expect(parseWordInput({ book: BOOK, term: 3, source: 'dictionary' })).toBeNull()
    expect(parseWordInput(null)).toBeNull()
    expect(parseWordInput([])).toBeNull()
  })

  it('refuses a term lookupTerm refuses, and one over 200 characters before normalising', () => {
    expect(parseWordInput({ book: BOOK, term: 'four words in it', source: 'dictionary' })).toBeNull()
    expect(parseWordInput({ book: BOOK, term: '1813', source: 'dictionary' })).toBeNull()
    expect(parseWordInput({ book: BOOK, term: `${' '.repeat(195)}chaise`, source: 'dictionary' })).toBeNull()
    expect(parseWordInput({ book: BOOK, term: `${' '.repeat(190)}chaise`, source: 'dictionary' })).toMatchObject({
      term: 'chaise',
    })
  })

  it('removes control characters', () => {
    expect(parseWordInput({ book: BOOK, term: 'cha\u0000ise', source: 'dictionary' })).toMatchObject({ term: 'chaise' })
  })
})

describe('parseTranslateInput', () => {
  it('takes a term with its sentence', () => {
    expect(parseTranslateInput({ book: BOOK, text: 'chaise,', context: 'In a  chaise and four.', to: 'tr' })).toEqual({
      book: BOOK,
      text: 'chaise',
      kind: 'term',
      context: 'In a chaise and four.',
      to: 'tr',
    })
    expect(parseTranslateInput({ book: BOOK, text: 'chaise', to: 'de' })).toMatchObject({ context: null })
  })

  it('takes a passage as selected, keeping its paragraphs, and drops any context', () => {
    const text = 'It is a truth universally acknowledged.\n\nHowever little known.'
    expect(parseTranslateInput({ book: BOOK, text, context: 'x', to: 'zh-Hant' })).toEqual({
      book: BOOK,
      text,
      kind: 'passage',
      context: null,
      to: 'zh-Hant',
    })
  })

  it('takes up to 1,000 characters after whitespace is collapsed, and a context up to 1,000', () => {
    expect(parseTranslateInput({ book: BOOK, text: 'é '.repeat(500), to: 'tr' })).toMatchObject({ kind: 'passage' })
    expect(parseTranslateInput({ book: BOOK, text: 'é'.repeat(1001), to: 'tr' })).toBeNull()
    expect(parseTranslateInput({ book: BOOK, text: 'chaise', context: 'é'.repeat(1000), to: 'tr' })).not.toBeNull()
    expect(parseTranslateInput({ book: BOOK, text: 'chaise', context: 'é'.repeat(1001), to: 'tr' })).toBeNull()
  })

  it('refuses a target outside the list, unknown fields, empty text and wrong types', () => {
    expect(parseTranslateInput({ book: BOOK, text: 'chaise', to: 'xx' })).toBeNull()
    expect(parseTranslateInput({ book: BOOK, text: 'chaise', to: 'zh' })).toBeNull()
    expect(parseTranslateInput({ book: BOOK, text: 'chaise', to: 'tr', model: 'opus' })).toBeNull()
    expect(parseTranslateInput({ book: BOOK, text: ' \u0007 ', to: 'tr' })).toBeNull()
    expect(parseTranslateInput({ book: BOOK, text: 1, to: 'tr' })).toBeNull()
    expect(parseTranslateInput({ book: BOOK, text: 'chaise', context: 1, to: 'tr' })).toBeNull()
    expect(parseTranslateInput({ book: 'nope/../x', text: 'chaise', to: 'tr' })).toBeNull()
    expect(parseTranslateInput('chaise')).toBeNull()
  })
})
