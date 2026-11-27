import { describe, expect, it } from 'vitest'
import { bookLine, dayLabel, dueLabel, nextDueLine } from '~/client/features/flashcards/dates'

const now = new Date(2026, 10, 9, 12, 0)
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString()

describe('dates', () => {
  it('shows the day and short month, with the year only outside this year', () => {
    expect(dayLabel(at(2026, 10, 14), now)).toBe('14 Nov')
    expect(dayLabel(at(2027, 0, 3), now)).toBe('3 Jan 2027')
  })

  it('says Due now for a time that has come, else when the next review is', () => {
    expect(dueLabel(at(2026, 10, 9, 11), now)).toBe('Due now')
    expect(dueLabel(now.toISOString(), now)).toBe('Due now')
    expect(dueLabel(at(2026, 10, 14), now)).toBe('Next review 14 Nov')
  })

  it('gives a book’s line with its due count, or when the next card is due', () => {
    expect(bookLine({ cards: 12, due: 3, nextDueAt: at(2026, 10, 1) }, now)).toBe('12 cards · 3 due')
    expect(bookLine({ cards: 1, due: 0, nextDueAt: at(2026, 10, 14) }, now)).toBe('1 card · next due 14 Nov')
    expect(bookLine({ cards: 1200, due: 1000, nextDueAt: at(2026, 10, 1) }, now)).toBe('1,200 cards · 1,000 due')
  })

  it('says when the next card is due, before and after a session', () => {
    expect(nextDueLine(at(2026, 10, 14), now, false)).toBe('Nothing due. Next card due on 14 Nov.')
    expect(nextDueLine(at(2026, 10, 14), now, true)).toBe('Done for now. Next card due on 14 Nov.')
    expect(nextDueLine(null, now, true)).toBe('Done for now. You’ve reviewed every card.')
    expect(nextDueLine(null, now, false)).toBe('No cards in this book yet.')
  })
})
