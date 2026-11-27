import { useState } from 'react'
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { REVIEW_PROBLEM } from '~/client/features/flashcards/flashcard-problems'
import { ReviewSession } from '~/client/features/flashcards/ReviewSession'
import type { FlashcardErrorCode } from '~/server/flashcards/actions'
import type { FlashcardView } from '~/shared/flashcards/contract'
import { isObject } from '~/shared/lib/json-shape'
import type { ErrorAnswer } from '../../../../support/client/answers'
import { mountAt } from '../../../../support/client/router'

const card = (id: number, front: string, back: string, dueAt: string) =>
  ({
    id: `6f1c0000-0000-4000-8000-00000000000${id}`,
    front,
    back,
    source: null,
    box: 0,
    dueAt,
    createdAt: '2026-11-01T10:00:00Z',
  }) satisfies FlashcardView

/** Due long ago, so these are due whenever the tests run; the later card is due in a year the label spells out. */
const WHO = card(1, 'Who wrote Walden?', 'Thoreau', '2026-11-01T10:00:00Z')
const WHERE = card(2, 'Where is Walden Pond?', 'Concord,\nMassachusetts', '2026-11-02T10:00:00Z')
const LATER = card(3, 'When did he move there?', '1845', '2099-03-01T12:00:00Z')

/** A card the server has moved on to its next box, as the review endpoint answers with it. */
const reviewed = (view: FlashcardView) => ({ ...view, box: view.box + 1, dueAt: '2099-01-15T12:00:00Z' })

/**
 * The review endpoint's answers. A card's answer has no contract type of its own (#22 left the flashcards answers
 * hand-written), so it is checked against `FlashcardView`; a refusal is checked against the route's error codes.
 */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const cardAnswer = (view: FlashcardView) => json(200, { card: view } satisfies { card: FlashcardView })
const refusal = (status: number, body: ErrorAnswer<FlashcardErrorCode>) => json(status, body)

let fetchSpy: MockInstance<typeof fetch>

/** The paths and bodies posted, in order. */
const sent = () =>
  fetchSpy.mock.calls.map(([input, init]) => {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    return [String(input), isObject(body) ? body : null]
  })

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer was set up'))
})

/** The session as the Flashcards page holds it: each graded card replaces the page's copy, which the end line reads. */
function Session({
  due,
  cards,
  deleted,
  onGraded,
}: {
  due: FlashcardView[]
  cards: FlashcardView[]
  deleted: string[]
  onGraded: (view: FlashcardView) => void
}) {
  const [held, setHeld] = useState(cards)
  return (
    <ReviewSession
      due={due}
      cards={held}
      deleted={deleted}
      onGraded={(view) => {
        onGraded(view)
        setHeld((all) => all.map((c) => (c.id === view.id ? view : c)))
      }}
    />
  )
}

async function mountReview({
  due = [WHO, WHERE],
  cards = [WHO, WHERE, LATER],
  deleted = [],
}: {
  due?: FlashcardView[]
  cards?: FlashcardView[]
  deleted?: string[]
} = {}) {
  const onGraded = vi.fn<(view: FlashcardView) => void>()
  await mountAt(
    '/account/flashcards?book=walden',
    <Session due={due} cards={cards} deleted={deleted} onGraded={onGraded} />,
  )
  await expect.element(review).toBeVisible()
  return onGraded
}

const review = page.getByRole('region', { name: 'Review' })
const start = review.getByRole('button', { name: /^Start review/ })
const showAnswer = review.getByRole('button', { name: 'Show answer' })
const again = review.getByRole('button', { name: 'Again' })
const gotIt = review.getByRole('button', { name: 'Got it' })
const problem = review.getByRole('alert')

/**
 * The card's two sides, the progress line and the closing line are plain paragraphs with no role of their own, so
 * they're found by their text.
 */
const words = (text: string | RegExp) => review.getByText(text)
/** The answer is a plain paragraph too, whose words follow a hidden “Answer:”, so it's found by its test id. */
const answer = review.getByTestId('review-answer')

describe('ReviewSession', () => {
  it('offers to start a review of the cards that are due', async () => {
    await mountReview()
    await expect.element(start).toHaveAccessibleName('Start review (2)')
    await expect.element(words(WHO.front)).not.toBeInTheDocument()
  })

  it('shows a card’s front, then its answer, and moves on when it’s graded Got it', async () => {
    fetchSpy.mockResolvedValueOnce(cardAnswer(reviewed(WHO)))
    const onGraded = await mountReview()
    await start.click()
    await expect.element(words('Card 1 of 2')).toBeVisible()
    await expect.element(words(WHO.front)).toHaveFocus()
    await expect.element(answer).not.toBeInTheDocument()
    await showAnswer.click()
    await expect.element(answer).toHaveTextContent('Answer: Thoreau')
    await expect.element(answer).toHaveFocus()
    await gotIt.click()
    await expect.element(words('Card 2 of 2')).toBeVisible()
    await expect.element(words(WHERE.front)).toHaveFocus()
    expect(sent()).toEqual([[`/account/flashcards/${WHO.id}`, { review: 'good' }]])
    expect(onGraded).toHaveBeenCalledExactlyOnceWith(reviewed(WHO))
  })

  it('brings a card graded Again back once at the end of the queue', async () => {
    fetchSpy
      .mockResolvedValueOnce(cardAnswer(reviewed(WHO)))
      .mockResolvedValueOnce(cardAnswer(WHERE))
      .mockResolvedValueOnce(cardAnswer(reviewed(WHERE)))
    await mountReview()
    await start.click()
    await showAnswer.click()
    await gotIt.click()
    await showAnswer.click()
    await again.click()
    await expect.element(words('Card 3 of 3')).toBeVisible()
    await expect.element(words(WHERE.front)).toBeVisible()
    await showAnswer.click()
    await gotIt.click()
    await expect.element(words('Done for now. Next card due on 15 Jan 2099.')).toBeVisible()
    expect(sent().map(([, body]) => body)).toEqual([{ review: 'good' }, { review: 'again' }, { review: 'good' }])
  })

  it('shows the answer with Space and grades with 1 and 2', async () => {
    fetchSpy.mockResolvedValueOnce(cardAnswer(WHO)).mockResolvedValueOnce(cardAnswer(reviewed(WHERE)))
    await mountReview()
    await start.click()
    await expect.element(words(WHO.front)).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect.element(answer).toHaveFocus()
    await userEvent.keyboard('1')
    await expect.element(words('Card 2 of 3')).toBeVisible()
    await userEvent.keyboard('{Control>}2{/Control}')
    await userEvent.keyboard('2')
    await expect.element(gotIt).not.toBeInTheDocument()
    await userEvent.keyboard(' ')
    await userEvent.keyboard('2')
    await expect.element(words('Card 3 of 3')).toBeVisible()
    expect(sent().map(([, body]) => body)).toEqual([{ review: 'again' }, { review: 'good' }])
  })

  it('leaves Space to a focused button rather than showing the answer', async () => {
    await mountReview()
    await start.click()
    ;(showAnswer.element() as HTMLButtonElement).focus()
    await userEvent.keyboard(' ')
    await expect.element(answer).toBeVisible()
    await expect.element(answer).toHaveFocus()
  })

  it('ends the review with when the next card is due, and a way back to every book', async () => {
    fetchSpy.mockResolvedValueOnce(cardAnswer(reviewed(WHO)))
    await mountReview({ due: [WHO], cards: [WHO, LATER] })
    await start.click()
    await showAnswer.click()
    await gotIt.click()
    const end = words('Done for now. Next card due on 15 Jan 2099.')
    await expect.element(end).toBeVisible()
    await expect.element(end).toHaveFocus()
    await expect
      .element(review.getByRole('link', { name: 'Back to all books' }))
      .toHaveAttribute('href', '/account/flashcards')
  })

  it('says every card is reviewed when none is left to come', async () => {
    fetchSpy.mockResolvedValueOnce(cardAnswer(reviewed(WHO)))
    /** The book's cards are empty, as when the last one was deleted in another tab, so no next date is left. */
    await mountReview({ due: [WHO], cards: [] })
    await start.click()
    await showAnswer.click()
    await gotIt.click()
    await expect.element(words('Done for now. You’ve reviewed every card.')).toBeVisible()
  })

  it('says when the next card is due when none is due now', async () => {
    await mountReview({ due: [], cards: [LATER] })
    await expect.element(words('Nothing due. Next card due on 1 Mar 2099.')).toBeVisible()
    await expect.element(start).not.toBeInTheDocument()
  })

  it('says the book has no cards when it has none', async () => {
    await mountReview({ due: [], cards: [] })
    await expect.element(words('No cards in this book yet.')).toBeVisible()
  })

  it('leaves out cards deleted from the page', async () => {
    await mountReview({ deleted: [WHO.id] })
    await expect.element(start).toHaveAccessibleName('Start review (1)')
    await start.click()
    await expect.element(words('Card 1 of 1')).toBeVisible()
    await expect.element(words(WHERE.front)).toBeVisible()
  })

  it.each([
    ['the reader has been signed out', () => refusal(401, { error: 'signed_out' })],
    ['the server fails', () => refusal(500, { error: 'failed' })],
    ['the card has gone', () => refusal(404, { error: 'not_found' })],
  ])('says the grade wasn’t saved when %s, and keeps the card', async (_, answer) => {
    fetchSpy.mockResolvedValueOnce(answer())
    const onGraded = await mountReview()
    await start.click()
    await showAnswer.click()
    await gotIt.click()
    await expect.element(problem.getByText(REVIEW_PROBLEM)).toBeVisible()
    await expect.element(words('Card 1 of 2')).toBeVisible()
    expect(onGraded).not.toHaveBeenCalled()
  })

  it('says the grade wasn’t saved when the reader is offline, and sends it again on Retry', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(cardAnswer(reviewed(WHO)))
    const onGraded = await mountReview()
    await start.click()
    await showAnswer.click()
    await again.click()
    await expect.element(problem.getByText(REVIEW_PROBLEM)).toBeVisible()
    await problem.getByRole('button', { name: 'Retry' }).click()
    await expect.element(words('Card 2 of 3')).toBeVisible()
    await expect.element(problem).not.toBeInTheDocument()
    expect(sent().map(([, body]) => body)).toEqual([{ review: 'again' }, { review: 'again' }])
    expect(onGraded).toHaveBeenCalledExactlyOnceWith(reviewed(WHO))
  })

  it('holds the grade buttons while a grade is being saved', async () => {
    let arrive: (response: Response) => void = () => {}
    fetchSpy.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        arrive = resolve
      }),
    )
    await mountReview()
    await start.click()
    await showAnswer.click()
    await gotIt.click()
    await expect.element(gotIt).toBeDisabled()
    await expect.element(again).toBeDisabled()
    await userEvent.keyboard('1')
    arrive(cardAnswer(reviewed(WHO)))
    await expect.element(words('Card 2 of 2')).toBeVisible()
    expect(fetchSpy).toHaveBeenCalledOnce()
  })
})
