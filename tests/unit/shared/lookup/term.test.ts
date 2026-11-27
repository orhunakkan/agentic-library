import { describe, expect, it } from 'vitest'
import { lookupTerm, PASSAGE_MAX, selectionKind, TERM_MAX } from '~/shared/lookup/term'

describe('lookupTerm', () => {
  it('strips punctuation, symbols and typographic quotes from either end', () => {
    expect(lookupTerm('“entailed,”')).toBe('entailed')
    expect(lookupTerm('(Netherfield)!')).toBe('Netherfield')
    expect(lookupTerm('—chaise…')).toBe('chaise')
    expect(lookupTerm('«bientôt»')).toBe('bientôt')
    expect(lookupTerm('$price+')).toBe('price')
  })

  it('drops a final ’s or ’s', () => {
    expect(lookupTerm('Darcy’s')).toBe('Darcy')
    expect(lookupTerm("Darcy's.")).toBe('Darcy')
  })

  it('keeps inner hyphens and apostrophes', () => {
    expect(lookupTerm('well-bred')).toBe('well-bred')
    expect(lookupTerm("o'clock")).toBe("o'clock")
  })

  it('collapses whitespace and normalises to NFC', () => {
    expect(lookupTerm('  Lucas \n Lodge ')).toBe('Lucas Lodge')
    expect(lookupTerm('café')).toBe('café')
  })

  it('takes up to three words and 60 characters', () => {
    expect(lookupTerm('in the event')).toBe('in the event')
    expect(lookupTerm('in the event of')).toBeNull()
    expect(lookupTerm('a'.repeat(TERM_MAX))).toBe('a'.repeat(TERM_MAX))
    expect(lookupTerm('a'.repeat(TERM_MAX + 1))).toBeNull()
  })

  it('needs a letter', () => {
    expect(lookupTerm('1813')).toBeNull()
    expect(lookupTerm('§ † ‡')).toBeNull()
    expect(lookupTerm('')).toBeNull()
    expect(lookupTerm('  ')).toBeNull()
    expect(lookupTerm('1st')).toBe('1st')
  })
})

describe('selectionKind', () => {
  it('is a term for a word, a passage for anything else up to 1,000 characters, and nothing past it', () => {
    expect(selectionKind('Netherfield')).toBe('term')
    expect(selectionKind('It is a truth universally acknowledged.')).toBe('passage')
    expect(selectionKind('x '.repeat(PASSAGE_MAX / 2))).toBe('passage')
    expect(selectionKind('é'.repeat(PASSAGE_MAX))).toBe('passage')
    expect(selectionKind('é'.repeat(PASSAGE_MAX + 1))).toBeNull()
    expect(selectionKind('   ')).toBeNull()
  })

  it('counts the length after whitespace is collapsed', () => {
    expect(selectionKind(`${'a '.repeat(400)}\n\n\n${'b '.repeat(99)}`)).toBe('passage')
  })
})
