import type { FlashcardView } from '~/shared/flashcards/contract'
import type { ReviewResult } from '~/shared/flashcards/schedule'

export interface ReviewQueue {
  cards: FlashcardView[]
  at: number
  again: string[]
}

export const startQueue = (due: readonly FlashcardView[]): ReviewQueue => ({ cards: [...due], at: 0, again: [] })

export const currentCard = (queue: ReviewQueue): FlashcardView | null => queue.cards[queue.at] ?? null

export const isFinished = (queue: ReviewQueue) => queue.at >= queue.cards.length

export const progress = (queue: ReviewQueue) =>
  `Card ${Math.min(queue.at + 1, queue.cards.length)} of ${queue.cards.length}`

export function grade(queue: ReviewQueue, result: ReviewResult, updated: FlashcardView): ReviewQueue {
  const card = currentCard(queue)
  if (!card) return queue
  const cards = queue.cards.map((c, i) => (i === queue.at ? updated : c))
  const back = result === 'again' && !queue.again.includes(card.id)
  return {
    cards: back ? [...cards, updated] : cards,
    at: queue.at + 1,
    again: back ? [...queue.again, card.id] : queue.again,
  }
}

export function withoutCard(queue: ReviewQueue, id: string): ReviewQueue {
  const before = queue.cards.slice(0, queue.at).filter((c) => c.id !== id).length
  return { ...queue, cards: queue.cards.filter((c) => c.id !== id), at: before }
}
