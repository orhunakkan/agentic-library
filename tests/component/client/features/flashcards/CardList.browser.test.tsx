import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page } from 'vitest/browser'
import { CardList } from '~/client/features/flashcards/CardList'
import { DELETE_PROBLEM } from '~/client/features/flashcards/flashcard-problems'
import type { FlashcardErrorCode } from '~/server/flashcards/actions'
import type { FlashcardView } from '~/shared/flashcards/contract'
import { isObject } from '~/shared/lib/json-shape'
import type { ErrorAnswer } from '../../../../support/client/answers'
import { mountAt } from '../../../../support/client/router'

const WHO = {
  id: '6f1c0000-0000-4000-8000-000000000001',
  front: 'Who wrote Walden?',
  back: 'Thoreau',
  source: { pageHref: '/read/walden/economy/2', label: 'Ch. 1 · p. 2' },
  box: 0,
  dueAt: '2026-11-01T10:00:00Z',
  createdAt: '2026-11-01T10:00:00Z',
} satisfies FlashcardView
const WHERE = {
  id: '6f1c0000-0000-4000-8000-000000000002',
  front: 'Where is Walden Pond?',
  back: 'Concord, Massachusetts',
  source: null,
  box: 2,
  dueAt: '2099-03-01T12:00:00Z',
  createdAt: '2026-11-02T10:00:00Z',
} satisfies FlashcardView

/**
 * The delete endpoint's answers. Its success has no contract type of its own (#22 left the flashcards answers
 * hand-written), so it is checked against its one field; a refusal is checked against the route's error codes.
 */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const deletedAnswer = () => json(200, { deleted: true } satisfies { deleted: true })
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

async function mountList(cards: FlashcardView[] = [WHO, WHERE]) {
  const onDeleted = vi.fn<(id: string) => void>()
  await mountAt('/account/flashcards?book=walden', <CardList cards={cards} onDeleted={onDeleted} />)
  return onDeleted
}

const items = page.getByRole('listitem')
const item = (front: string) => items.filter({ hasText: front })

describe('CardList', () => {
  it('lists each card’s two sides, where it came from and when it’s next due', async () => {
    await mountList()
    await expect.element(page.getByRole('list')).toBeVisible()
    expect(items.elements()).toHaveLength(2)
    /** A card's sides and due date are plain paragraphs and text, with no role of their own. */
    const who = item(WHO.front)
    await expect.element(who.getByText('Thoreau')).toBeVisible()
    await expect.element(who.getByText('Due now')).toBeVisible()
    await expect
      .element(who.getByRole('link', { name: 'From Ch. 1 · p. 2' }))
      .toHaveAttribute('href', '/read/walden/economy/2')
    const where = item(WHERE.front)
    await expect.element(where.getByText('Next review 1 Mar 2099')).toBeVisible()
    await expect.element(where.getByRole('link')).not.toBeInTheDocument()
  })

  it('says the book has no cards left when the list is empty', async () => {
    await mountList([])
    await expect.element(page.getByText('No cards left in this book.')).toBeVisible()
    await expect.element(page.getByRole('list')).not.toBeInTheDocument()
  })

  it('asks before deleting a card, and deletes it on Delete', async () => {
    fetchSpy.mockResolvedValueOnce(deletedAnswer())
    const onDeleted = await mountList()
    const who = item(WHO.front)
    await who.getByRole('button', { name: 'Delete this card' }).click()
    await expect.element(who.getByText('Delete this card?')).toBeVisible()
    await who.getByRole('button', { name: 'Delete', exact: true }).click()
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledExactlyOnceWith(WHO.id))
    expect(sent()).toEqual([[`/account/flashcards/${WHO.id}`, { delete: true }]])
  })

  it('keeps the card when the reader cancels', async () => {
    const onDeleted = await mountList()
    const who = item(WHO.front)
    await who.getByRole('button', { name: 'Delete this card' }).click()
    await who.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(who.getByText('Delete this card?')).not.toBeInTheDocument()
    await expect.element(who.getByRole('button', { name: 'Delete this card' })).toBeVisible()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('takes a card off the list when it was deleted already', async () => {
    fetchSpy.mockResolvedValueOnce(refusal(404, { error: 'not_found' }))
    const onDeleted = await mountList()
    await item(WHO.front).getByRole('button', { name: 'Delete this card' }).click()
    await item(WHO.front).getByRole('button', { name: 'Delete', exact: true }).click()
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledExactlyOnceWith(WHO.id))
  })

  it.each([
    ['the server fails', () => fetchSpy.mockResolvedValueOnce(refusal(500, { error: 'failed' }))],
    ['the reader is offline', () => fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))],
  ])('says the card wasn’t deleted when %s, and can try again', async (_, fail) => {
    fail()
    fetchSpy.mockResolvedValueOnce(deletedAnswer())
    const onDeleted = await mountList()
    const who = item(WHO.front)
    await who.getByRole('button', { name: 'Delete this card' }).click()
    const confirm = who.getByRole('button', { name: 'Delete', exact: true })
    await confirm.click()
    await expect.element(who.getByRole('alert')).toHaveTextContent(DELETE_PROBLEM)
    expect(onDeleted).not.toHaveBeenCalled()
    await confirm.click()
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledExactlyOnceWith(WHO.id))
  })

  it('clears the problem when the reader cancels after it', async () => {
    fetchSpy.mockResolvedValueOnce(refusal(500, { error: 'failed' }))
    await mountList()
    const who = item(WHO.front)
    await who.getByRole('button', { name: 'Delete this card' }).click()
    await who.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.element(who.getByRole('alert')).toBeVisible()
    await who.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(who.getByRole('alert')).not.toBeInTheDocument()
  })

  it('holds the Delete button while the card is being deleted', async () => {
    fetchSpy.mockReturnValueOnce(new Promise<Response>(() => {}))
    await mountList()
    const who = item(WHO.front)
    await who.getByRole('button', { name: 'Delete this card' }).click()
    const confirm = who.getByRole('button', { name: 'Delete', exact: true })
    await confirm.click()
    await expect.element(confirm).toBeDisabled()
  })
})
