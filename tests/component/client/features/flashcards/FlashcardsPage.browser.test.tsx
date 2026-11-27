import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page } from 'vitest/browser'
import { BookFlashcardsPage, FlashcardBooksPage } from '~/client/features/flashcards/FlashcardsPage'
import type { BookFlashcards, FlashcardBookSummary, FlashcardView } from '~/shared/flashcards/contract'
import { mountAt } from '../../../../support/client/router'

const WALDEN = {
  slug: 'walden',
  title: 'Walden',
  removed: false,
  cards: 3,
  due: 2,
  nextDueAt: '2026-11-01T10:00:00Z',
  activeAt: '2026-11-20T10:00:00Z',
} satisfies FlashcardBookSummary
const ESSAYS = {
  slug: 'essays',
  title: 'Essays',
  removed: false,
  cards: 1,
  due: 0,
  nextDueAt: '2099-03-01T12:00:00Z',
  activeAt: '2026-11-10T10:00:00Z',
} satisfies FlashcardBookSummary
const GONE = {
  slug: 'gone-book',
  title: 'A Removed Book',
  removed: true,
  cards: 4,
  due: 4,
  nextDueAt: '2026-11-01T10:00:00Z',
  activeAt: '2026-11-01T10:00:00Z',
} satisfies FlashcardBookSummary

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
const WHO = card(1, 'Who wrote Walden?', 'Thoreau', '2026-11-01T10:00:00Z')
const WHERE = card(2, 'Where is Walden Pond?', 'Concord', '2026-11-02T10:00:00Z')
const LATER = card(3, 'When did he move there?', '1845', '2099-03-01T12:00:00Z')
const BOOK = {
  book: { slug: 'walden', title: 'Walden', href: '/library/walden/walden' },
  cards: [WHO, WHERE, LATER],
  due: [WHO, WHERE],
} satisfies BookFlashcards

/** The flashcard endpoints' answers, written by hand as no contract types them (#22). */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer was set up'))
})

const books = page.getByRole('region', { name: 'Your books' })
const bookItem = (title: string) => books.getByRole('listitem').filter({ hasText: title })

describe('FlashcardBooksPage', () => {
  it('lists each book with its cards, a link to review those due, and a way to delete them all', async () => {
    await mountAt('/account/flashcards', <FlashcardBooksPage books={[WALDEN, ESSAYS]} />)
    await expect.element(page.getByRole('heading', { level: 1, name: 'Flashcards' })).toBeVisible()
    await expect.element(page.getByRole('navigation', { name: 'Account' })).toBeVisible()
    const walden = bookItem('Walden')
    await expect
      .element(walden.getByRole('link', { name: 'Walden' }))
      .toHaveAttribute('href', '/account/flashcards?book=walden')
    /** A book's count line is plain text, with no role of its own. */
    await expect.element(walden.getByText('3 cards · 2 due')).toBeVisible()
    await expect
      .element(walden.getByRole('link', { name: 'Review 2 cards in Walden' }))
      .toHaveAttribute('href', '/account/flashcards?book=walden')
    await expect.element(walden.getByRole('button', { name: 'Delete all cards for Walden' })).toBeVisible()
    const essays = bookItem('Essays')
    await expect.element(essays.getByText('1 card · next due 1 Mar 2099')).toBeVisible()
    await expect.element(essays.getByRole('link', { name: /^Review/ })).not.toBeInTheDocument()
  })

  it('shows a removed book’s title without a link, and offers only to delete its cards', async () => {
    await mountAt('/account/flashcards', <FlashcardBooksPage books={[GONE]} />)
    const gone = bookItem('A Removed Book')
    await expect.element(gone.getByText('A Removed Book')).toBeVisible()
    await expect.element(gone.getByRole('link')).not.toBeInTheDocument()
    await expect.element(gone.getByRole('button', { name: 'Delete all cards for A Removed Book' })).toBeVisible()
  })

  it('says how to make flashcards when there are none', async () => {
    await mountAt('/account/flashcards', <FlashcardBooksPage books={[]} />)
    await expect.element(books.getByText(/^No flashcards yet\./)).toBeVisible()
    await expect.element(books.getByRole('list')).not.toBeInTheDocument()
  })

  it('confirms a book’s cards were deleted', async () => {
    await mountAt('/account/flashcards', <FlashcardBooksPage books={[ESSAYS]} notice="deleted-book" />)
    await expect.element(page.getByRole('status')).toHaveTextContent('Deleted every card in that book.')
  })

  it.each([
    ['missing', 'Those cards weren’t found. They may have been deleted already.'],
    ['invalid', 'That request wasn’t understood. Try again.'],
    ['unavailable', 'Something went wrong. Try again in a few minutes.'],
  ] as const)('says what went wrong when the notice is %s', async (notice, text) => {
    await mountAt('/account/flashcards', <FlashcardBooksPage books={[]} notice={notice} />)
    await expect.element(page.getByRole('alert')).toHaveTextContent(text)
  })
})

describe('BookFlashcardsPage', () => {
  const review = page.getByRole('region', { name: 'Review' })
  const allCards = page.getByRole('region', { name: /^All cards/ })

  it('links to the book and back to every book, with its review and all its cards', async () => {
    await mountAt('/account/flashcards?book=walden', <BookFlashcardsPage data={BOOK} />)
    await expect.element(page.getByRole('link', { name: 'Walden' })).toHaveAttribute('href', '/library/walden/walden')
    await expect.element(page.getByRole('link', { name: '← All books' })).toHaveAttribute('href', '/account/flashcards')
    await expect.element(review.getByRole('button', { name: 'Start review (2)' })).toBeVisible()
    await expect.element(allCards.getByRole('heading', { name: 'All cards (3)' })).toBeVisible()
    expect(allCards.getByRole('listitem').elements()).toHaveLength(3)
  })

  it('shows a graded card’s next review in the list', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { card: { ...WHO, box: 1, dueAt: '2099-01-15T12:00:00Z' } }))
    await mountAt('/account/flashcards?book=walden', <BookFlashcardsPage data={BOOK} />)
    const who = allCards.getByRole('listitem').filter({ hasText: WHO.front })
    await expect.element(who.getByText('Due now')).toBeVisible()
    await review.getByRole('button', { name: 'Start review (2)' }).click()
    await review.getByRole('button', { name: 'Show answer' }).click()
    await review.getByRole('button', { name: 'Got it' }).click()
    await expect.element(who.getByText('Next review 15 Jan 2099')).toBeVisible()
  })

  it('takes a deleted card out of the list and the review', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { deleted: true }))
    await mountAt('/account/flashcards?book=walden', <BookFlashcardsPage data={BOOK} />)
    const who = allCards.getByRole('listitem').filter({ hasText: WHO.front })
    await who.getByRole('button', { name: 'Delete this card' }).click()
    await who.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.element(allCards.getByRole('heading', { name: 'All cards (2)' })).toBeVisible()
    await expect.element(who).not.toBeInTheDocument()
    await expect.element(review.getByRole('button', { name: 'Start review (1)' })).toBeVisible()
  })

  it('takes a card deleted mid-review out of the queue', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { deleted: true }))
    await mountAt('/account/flashcards?book=walden', <BookFlashcardsPage data={BOOK} />)
    await review.getByRole('button', { name: 'Start review (2)' }).click()
    /** The progress line is plain text, with no role of its own. */
    await expect.element(review.getByText('Card 1 of 2')).toBeVisible()
    const where = allCards.getByRole('listitem').filter({ hasText: WHERE.front })
    await where.getByRole('button', { name: 'Delete this card' }).click()
    await where.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.element(review.getByText('Card 1 of 1')).toBeVisible()
  })
})
