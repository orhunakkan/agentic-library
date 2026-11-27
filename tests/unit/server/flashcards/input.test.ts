import { describe, expect, it } from 'vitest'
import { parseCardChange, parseNewCard } from '~/server/flashcards/input'
import { citationMarker } from '~/shared/ask/events'
import { privateBookSlug } from '~/shared/content/book-slug'

const base = {
  book: 'pride-and-prejudice',
  front: 'Who is Mr. Darcy?',
  back: 'A rich, proud gentleman.',
  position: { chapter: 'chapter-3', page: 2 },
  origin: 'flashcards',
}

describe('parseNewCard', () => {
  it('accepts a card from a set of flashcards or a quiz, on a catalogue or a private book', () => {
    expect(parseNewCard(base)).toEqual(base)
    expect(parseNewCard({ ...base, origin: 'quiz' })?.origin).toBe('quiz')
    expect(parseNewCard({ ...base, book: privateBookSlug('7f9c2ba4-e88f-4c1c-9a3d-2b8b6c0f1a2e') })?.book).toBe(
      privateBookSlug('7f9c2ba4-e88f-4c1c-9a3d-2b8b6c0f1a2e'),
    )
    expect(parseNewCard({ ...base, position: { printedPage: 12 } })?.position).toEqual({ printedPage: 12 })
  })

  it('cleans the text and takes out citation markers', () => {
    const card = parseNewCard({
      ...base,
      front: '  Who\u0007 is he?  ',
      back: `Proud.${citationMarker(0)}${citationMarker(1)}`,
    })
    expect(card).toMatchObject({ front: 'Who is he?', back: 'Proud.' })
  })

  it('counts the limits in characters: a front of 200 and a back of 500', () => {
    expect(parseNewCard({ ...base, front: '🙂'.repeat(200), back: '🙂'.repeat(500) })).not.toBeNull()
    expect(parseNewCard({ ...base, front: 'x'.repeat(201) })).toBeNull()
    expect(parseNewCard({ ...base, back: 'x'.repeat(501) })).toBeNull()
  })

  it('refuses anything else', () => {
    for (const bad of [
      null,
      [],
      'card',
      { ...base, extra: 1 },
      { ...base, book: 'Not a slug' },
      { ...base, book: 'u-not-a-uuid' },
      { ...base, front: '' },
      { ...base, front: '   ' },
      { ...base, back: citationMarker(0) },
      { ...base, front: 7 },
      { ...base, back: null },
      { ...base, position: { chapter: 'chapter-3' } },
      { ...base, position: { chapter: 'chapter-3', page: 0 } },
      { ...base, origin: 'typed' },
      { book: base.book, front: base.front, back: base.back, position: base.position },
    ]) {
      expect(parseNewCard(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('parseCardChange', () => {
  it('takes a review or a delete, exactly', () => {
    expect(parseCardChange({ review: 'again' })).toEqual({ review: 'again' })
    expect(parseCardChange({ review: 'good' })).toEqual({ review: 'good' })
    expect(parseCardChange({ delete: true })).toEqual({ delete: true })
    for (const bad of [
      null,
      {},
      { review: 'easy' },
      { review: 'good', box: 5 },
      { delete: false },
      { delete: 'yes' },
      { delete: true, review: 'good' },
      { intent: 'delete' },
    ]) {
      expect(parseCardChange(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
