import { describe, expect, it } from 'vitest'
import { contextFor } from '~/shared/lookup/context'

const at = (text: string, word: string) => {
  const start = text.indexOf(word)
  return [start, start + word.length] as const
}

describe('contextFor', () => {
  const page =
    'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings may be, this truth is well fixed. Mr. Bennet replied that he had not.'

  it('gives the sentence a word is in', () => {
    expect(contextFor(page, ...at(page, 'acknowledged'), 'en')).toBe(
      'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
    )
    expect(contextFor(page, ...at(page, 'replied'), 'en')).toBe('Mr. Bennet replied that he had not.')
  })

  it('joins the sentences a selection runs across', () => {
    const [start] = at(page, 'wife')
    const [, end] = at(page, 'However')
    expect(contextFor(page, start, end, 'en')).toBe(
      'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings may be, this truth is well fixed.',
    )
  })

  it('collapses whitespace, at the start and end of a page', () => {
    const text = 'First   line\nof it.  Last  \t word'
    expect(contextFor(text, ...at(text, 'First'), 'en')).toBe('First line of it.')
    expect(contextFor(text, ...at(text, 'word'), 'en')).toBe('Last word')
  })

  it('cuts a sentence over 1,000 characters around the word, with … at each cut edge', () => {
    const long = `${'lead '.repeat(300)}target ${'tail '.repeat(300)}end.`
    const quote = contextFor(long, ...at(long, 'target'), 'en')
    expect(quote.length).toBeLessThanOrEqual(1000)
    expect(quote.startsWith('…')).toBe(true)
    expect(quote.endsWith('…')).toBe(true)
    const middle = quote.indexOf('target')
    expect(Math.abs(middle - quote.length / 2)).toBeLessThan(20)
  })

  it('cuts only the side that is too long when the word is near an edge', () => {
    const long = `Start target ${'tail '.repeat(400)}end.`
    const quote = contextFor(long, ...at(long, 'target'), 'en')
    expect(quote.startsWith('Start target')).toBe(true)
    expect(quote.endsWith('…')).toBe(true)
    const late = `${'lead '.repeat(400)}target end.`
    const back = contextFor(late, ...at(late, 'target'), 'en')
    expect(back.startsWith('…')).toBe(true)
    expect(back.endsWith('target end.')).toBe(true)
  })

  it('never splits a surrogate pair at a cut', () => {
    const long = `${'𝔞'.repeat(600)}target${'𝔟'.repeat(600)}`
    const quote = contextFor(long, ...at(long, 'target'), 'en')
    expect(quote.isWellFormed()).toBe(true)
  })

  it('works without Intl.Segmenter', () => {
    expect(contextFor(page, ...at(page, 'fixed'), 'en', { intl: false })).toBe(
      'However little known the feelings may be, this truth is well fixed.',
    )
  })
})
