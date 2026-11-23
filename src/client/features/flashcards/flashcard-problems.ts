import { MAX_CARDS_PER_BOOK, MAX_CARDS_PER_USER } from '~/shared/flashcards/limits'
import { proNotice } from '~/shared/plans/copy'
import type { FlashcardProblem } from './flashcards-client'

const count = (n: number) => n.toLocaleString('en-GB')

export function saveProblemText(problem: FlashcardProblem): string {
  switch (problem) {
    case 'quota-book':
      return `You’ve reached ${count(MAX_CARDS_PER_BOOK)} flashcards for this book. Delete some on the Flashcards page to save more.`
    case 'quota-user':
      return `You’ve reached ${count(MAX_CARDS_PER_USER)} flashcards. Delete some on the Flashcards page to save more.`
    case 'signed_out':
      return 'Sign in again to save cards.'
    case 'pro':
      return proNotice('flashcards').heading
    default:
      return 'Couldn’t save the card. Try again.'
  }
}

export function cardCountLine(title: string, cards: number): string {
  return `${title}: ${count(cards)} ${cards === 1 ? 'card' : 'cards'}`
}

export const REVIEW_PROBLEM = 'Couldn’t save that. Try again.'

export const DELETE_PROBLEM = 'Couldn’t delete the card. Try again.'
