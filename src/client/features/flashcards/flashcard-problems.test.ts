import { describe, expect, it } from 'vitest'
import { cardCountLine, DELETE_PROBLEM, REVIEW_PROBLEM, saveProblemText } from './flashcard-problems'

describe('saveProblemText', () => {
  it('says each reason a card wasn’t saved', () => {
    expect(saveProblemText('quota-book')).toBe(
      'You’ve reached 1,000 flashcards for this book. Delete some on the Flashcards page to save more.',
    )
    expect(saveProblemText('quota-user')).toBe(
      'You’ve reached 10,000 flashcards. Delete some on the Flashcards page to save more.',
    )
    expect(saveProblemText('signed_out')).toBe('Sign in again to save cards.')
    expect(saveProblemText('pro')).toBe('Flashcards are part of Pro.')
    expect(saveProblemText('not_found')).toBe('Couldn’t save the card. Try again.')
    expect(saveProblemText('failed')).toBe('Couldn’t save the card. Try again.')
  })

  it('counts a book’s cards on Free', () => {
    expect(cardCountLine('Pride and Prejudice', 12)).toBe('Pride and Prejudice: 12 cards')
    expect(cardCountLine('Emma', 1)).toBe('Emma: 1 card')
    expect(cardCountLine('Emma', 1200)).toBe('Emma: 1,200 cards')
  })

  it('has fixed text for a failed grade and a failed delete', () => {
    expect(REVIEW_PROBLEM).toBe('Couldn’t save that. Try again.')
    expect(DELETE_PROBLEM).toBe('Couldn’t delete the card. Try again.')
  })
})
