import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page } from 'vitest/browser'
import { RemoveFromLibrary } from '~/client/features/removed-books/RemoveFromLibrary'
import { mountAt } from '../../../../support/client/router'

/** The command palette's search index is a server function; nothing here searches, so it is never called. */
vi.mock('~/server/functions', () => ({ getSearchIndex: vi.fn() }))

const BOOK_PAGE = '/library/poetry-of-the-spirit/the-prophet'

/** The server's answer to the change. */
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const removeButton = page.getByRole('button', { name: 'Remove from library' })

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

const mountSignedIn = () =>
  mountAt(BOOK_PAGE, <RemoveFromLibrary slug="the-prophet" removed={false} />, { viewer: { username: 'reader' } })

describe('RemoveFromLibrary', () => {
  it('shows no button to a visitor who is signed out', async () => {
    await mountAt(BOOK_PAGE, <RemoveFromLibrary slug="the-prophet" removed={false} />, { viewer: null })
    await expect.element(removeButton).not.toBeInTheDocument()
  })

  it('undoes a change the server failed to save, and says to try again', async () => {
    fetchSpy.mockResolvedValue(answer(500, { error: 'failed' }))
    await mountSignedIn()
    await removeButton.click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Couldn’t save that. Try again.')
    await expect.element(removeButton).toBeVisible()
    await expect.element(removeButton).toBeEnabled()
    expect(fetchSpy).toHaveBeenCalledWith('/account/removed-books', expect.objectContaining({ method: 'POST' }))
  })

  it('says a session that ended, with a Sign in link back to this page', async () => {
    fetchSpy.mockResolvedValue(answer(401, { error: 'signed_out' }))
    await mountSignedIn()
    await removeButton.click()
    const alert = page.getByRole('alert')
    await expect.element(alert).toHaveTextContent('Your session ended. Sign in')
    const signIn = alert.getByRole('link', { name: 'Sign in' })
    await expect.element(signIn).toBeVisible()
    const href = signIn.element().getAttribute('href') ?? ''
    expect(new URL(href, location.origin).pathname).toBe('/login')
    expect(new URL(href, location.origin).searchParams.get('next')).toBe(BOOK_PAGE)
    await expect.element(removeButton).toBeVisible()
  })
})
