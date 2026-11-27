import { describe, expect, it } from 'vitest'
import {
  currentCard,
  grade,
  isFinished,
  progress,
  startQueue,
  withoutCard,
} from '~/client/features/flashcards/review-queue'
import type { FlashcardView } from '~/shared/flashcards/contract'

const card = (id: string): FlashcardView => ({
  id,
  front: `front ${id}`,
  back: `back ${id}`,
  source: null,
  box: 0,
  dueAt: '2026-11-09T10:00:00Z',
  createdAt: '2026-11-09T10:00:00Z',
})
const graded = (c: FlashcardView, box: number) => ({ ...c, box })

describe('a review session', () => {
  it('goes through the due cards in order, with progress', () => {
    let q = startQueue([card('a'), card('b')])
    expect([currentCard(q)?.id, progress(q)]).toEqual(['a', 'Card 1 of 2'])
    q = grade(q, 'good', graded(card('a'), 1))
    expect([currentCard(q)?.id, progress(q)]).toEqual(['b', 'Card 2 of 2'])
    expect(q.cards[0]?.box).toBe(1)
    q = grade(q, 'good', graded(card('b'), 1))
    expect(isFinished(q)).toBe(true)
    expect(currentCard(q)).toBeNull()
    expect(grade(q, 'good', card('x'))).toBe(q)
  })

  it('sends a card back to the end once on Again, not twice', () => {
    let q = startQueue([card('a'), card('b'), card('c')])
    q = grade(q, 'again', card('a'))
    expect(progress(q)).toBe('Card 2 of 4')
    q = grade(q, 'good', card('b'))
    q = grade(q, 'good', card('c'))
    expect([currentCard(q)?.id, progress(q)]).toEqual(['a', 'Card 4 of 4'])
    q = grade(q, 'again', card('a'))
    expect(isFinished(q)).toBe(true)
    expect(q.cards.map((c) => c.id)).toEqual(['a', 'b', 'c', 'a'])
  })

  it('is finished at once with nothing due', () => {
    expect(isFinished(startQueue([]))).toBe(true)
  })

  it('drops a deleted card, keeping the place', () => {
    let q = startQueue([card('a'), card('b'), card('c')])
    q = grade(q, 'good', card('a'))
    q = withoutCard(q, 'a')
    expect([currentCard(q)?.id, progress(q)]).toEqual(['b', 'Card 1 of 2'])
    q = withoutCard(q, 'c')
    expect([currentCard(q)?.id, progress(q)]).toEqual(['b', 'Card 1 of 1'])
  })
})
