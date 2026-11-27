import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { AddToShelf } from '~/client/features/shelves/AddToShelf'
import { isObject } from '~/shared/lib/json-shape'
import type { ShelfAnswer, ShelfErrorAnswer, ShelfView, ShelvesState } from '~/shared/shelves/contract'
import { mountAt } from '../../../../support/client/router'

/** The reader's shelves, which the picker loads itself through this server function; each test says what it gives. */
const server = vi.hoisted(() => ({ getShelves: vi.fn<() => Promise<ShelvesState>>() }))
vi.mock('~/server/account-functions', () => server)

const BOOK = 'moby-dick'
const BOOK_PAGE = `/library/sea-stories/${BOOK}`
const CREATE_URL = '/account/shelves/new'

const TO_READ = { id: '6f1c0000-0000-4000-8000-000000000001', name: 'To read', books: [] } satisfies ShelfView
const FAVOURITES = {
  id: '6f1c0000-0000-4000-8000-000000000002',
  name: 'Favourites',
  books: ['emma'],
} satisfies ShelfView

const booksUrl = (shelf: ShelfView) => `/account/shelves/${shelf.id}/books`

/** The shelf endpoints' answers, typed by their contract so a renamed code or field fails the typecheck. */
const answer = (status: number, body: ShelfAnswer | ShelfErrorAnswer) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const shelfAnswer = (shelf: ShelfView) => answer(200, { shelf })

let fetchSpy: MockInstance<typeof fetch>

/** The paths and bodies posted, in order. */
const sent = () =>
  fetchSpy.mock.calls.map(([input, init]) => {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    return [String(input), isObject(body) ? body : null]
  })

beforeEach(() => {
  server.getShelves.mockResolvedValue({ state: 'ready', shelves: [TO_READ, FAVOURITES] })
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No answer was set up'))
})

/** Something else on the page, to click outside the picker. */
const elsewhere = page.getByRole('button', { name: 'Elsewhere' })

const mountSignedIn = () =>
  mountAt(
    BOOK_PAGE,
    <>
      <AddToShelf slug={BOOK} />
      <button type="button">Elsewhere</button>
    </>,
    { viewer: { username: 'reader' } },
  )

const trigger = page.getByRole('button', { name: 'Add to shelf' })
const picker = page.getByRole('dialog', { name: 'Add to shelf' })
const nameField = picker.getByRole('textbox', { name: 'New shelf' })
const addButton = picker.getByRole('button', { name: 'Add' })
const toReadBox = picker.getByRole('checkbox', { name: 'To read' })
const favouritesBox = picker.getByRole('checkbox', { name: 'Favourites' })
const alert = picker.getByRole('alert')

async function openPicker() {
  await mountSignedIn()
  await trigger.click()
  await expect.element(picker).toBeVisible()
}

/** The picker's loading, empty and unavailable lines are plain text with no role, so the tests find them by text. */
describe('AddToShelf', () => {
  it('shows nothing to a visitor who is signed out', async () => {
    await mountAt(BOOK_PAGE, <AddToShelf slug={BOOK} />, { viewer: null })
    await expect.element(trigger).not.toBeInTheDocument()
    expect(server.getShelves).not.toHaveBeenCalled()
  })

  it('lists the reader’s shelves by name, focusing the first, with a link to the library', async () => {
    await openPicker()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect.element(favouritesBox).toHaveFocus()
    const names = picker
      .getByRole('checkbox')
      .elements()
      .map((box) => box.closest('label')?.textContent)
    expect(names).toEqual(['Favourites', 'To read'])
    await expect.element(toReadBox).not.toBeChecked()
    const library = picker.getByRole('link', { name: 'Library' })
    expect(new URL(library.element().getAttribute('href') ?? '', location.origin).pathname).toBe('/library')
  })

  it('says it is loading until the shelves come', async () => {
    const shelves = Promise.withResolvers<ShelvesState>()
    server.getShelves.mockReturnValue(shelves.promise)
    await openPicker()
    const loading = picker.getByText('Loading your shelves…')
    await expect.element(loading).toBeVisible()
    shelves.resolve({ state: 'ready', shelves: [TO_READ] })
    await expect.element(toReadBox).toBeVisible()
    await expect.element(loading).not.toBeInTheDocument()
  })

  it('asks for a first shelf when the reader has none, with the name field focused', async () => {
    server.getShelves.mockResolvedValue({ state: 'ready', shelves: [] })
    await openPicker()
    await expect.element(picker.getByText('You have no shelves yet. Name one below.')).toBeVisible()
    await expect.element(nameField).toHaveFocus()
    await expect.element(addButton).toBeDisabled()
  })

  it('says the shelves couldn’t be loaded when the server can’t give them', async () => {
    server.getShelves.mockResolvedValue({ state: 'unavailable' })
    await openPicker()
    await expect.element(picker.getByText('Your shelves couldn’t be loaded.')).toBeVisible()
    await expect.element(picker.getByRole('checkbox')).not.toBeInTheDocument()
  })

  it('puts the book on a shelf, and names that shelf on the button', async () => {
    fetchSpy.mockResolvedValue(shelfAnswer({ ...TO_READ, books: [BOOK] }))
    await openPicker()
    await toReadBox.click()
    await expect.element(toReadBox).toBeChecked()
    expect(sent()).toEqual([[booksUrl(TO_READ), { book: BOOK, on: true }]])
    await expect.element(page.getByRole('button', { name: 'On “To read”' })).toHaveAttribute('title', 'On “To read”')
  })

  it('counts the shelves the book is on, and takes it off one', async () => {
    server.getShelves.mockResolvedValue({
      state: 'ready',
      shelves: [
        { ...TO_READ, books: [BOOK] },
        { ...FAVOURITES, books: [BOOK] },
      ],
    })
    fetchSpy.mockResolvedValue(shelfAnswer(FAVOURITES))
    await mountSignedIn()
    const onTwo = page.getByRole('button', { name: 'On 2 shelves' })
    await onTwo.click()
    await favouritesBox.click()
    await expect.element(favouritesBox).not.toBeChecked()
    expect(sent()).toEqual([[booksUrl(FAVOURITES), { book: BOOK, on: false }]])
    await expect.element(page.getByRole('button', { name: 'On “To read”' })).toBeVisible()
  })

  it('makes a new shelf with the book on it, held until the server keeps it', async () => {
    const created = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(created.promise)
    await openPicker()
    await nameField.fill('  Sea   stories ')
    await addButton.click()
    const newBox = picker.getByRole('checkbox', { name: 'Sea stories' })
    await expect.element(newBox).toBeChecked()
    await expect.element(newBox).toBeDisabled()
    await expect.element(nameField).toHaveValue('')
    expect(sent()).toEqual([[CREATE_URL, { name: 'Sea stories', book: BOOK }]])

    created.resolve(
      answer(201, { shelf: { id: '6f1c0000-0000-4000-8000-000000000003', name: 'Sea stories', books: [BOOK] } }),
    )
    await expect.element(newBox).toBeEnabled()
    await expect.element(newBox).toBeChecked()
  })

  it('adds the book to a shelf the reader names again, instead of making a second', async () => {
    fetchSpy.mockResolvedValue(shelfAnswer({ ...TO_READ, books: [BOOK] }))
    await openPicker()
    await nameField.fill('to READ')
    const addToExisting = picker.getByRole('button', { name: 'Add to “To read”' })
    await addToExisting.click()
    await expect.element(toReadBox).toBeChecked()
    expect(sent()).toEqual([[booksUrl(TO_READ), { book: BOOK, on: true }]])
  })

  it('sends nothing when the named shelf already has the book', async () => {
    server.getShelves.mockResolvedValue({ state: 'ready', shelves: [{ ...TO_READ, books: [BOOK] }] })
    await mountSignedIn()
    await page.getByRole('button', { name: 'On “To read”' }).click()
    await nameField.fill('To read')
    await picker.getByRole('button', { name: 'Add to “To read”' }).click()
    await expect.element(nameField).toHaveValue('')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('says a session that ended, with a Sign in link back to this page', async () => {
    fetchSpy.mockResolvedValue(answer(401, { error: 'signed_out' }))
    await openPicker()
    await toReadBox.click()
    await expect.element(alert).toHaveTextContent('Your session ended. Sign in')
    const href = alert.getByRole('link', { name: 'Sign in' }).element().getAttribute('href') ?? ''
    expect(new URL(href, location.origin).pathname).toBe('/login')
    expect(new URL(href, location.origin).searchParams.get('next')).toBe(BOOK_PAGE)
    await expect.element(toReadBox).not.toBeChecked()
  })

  it('takes a tick back when the server fails, and says to try again', async () => {
    fetchSpy.mockResolvedValue(answer(500, { error: 'failed' }))
    await openPicker()
    await toReadBox.click()
    await expect.element(alert).toHaveTextContent('Couldn’t save that. Try again.')
    await expect.element(alert.getByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
    await expect.element(toReadBox).not.toBeChecked()
  })

  it('takes a tick back when the reader is offline', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'))
    await openPicker()
    await toReadBox.click()
    await expect.element(alert).toHaveTextContent('Couldn’t save that. Try again.')
    await expect.element(toReadBox).not.toBeChecked()
  })

  it('says the most books the shelves can hold', async () => {
    fetchSpy.mockResolvedValue(answer(409, { error: 'quota', scope: 'shelf_books', max: 2000 }))
    await openPicker()
    await toReadBox.click()
    await expect.element(alert).toHaveTextContent('Your shelves can hold up to 2,000 books in all.')
    await expect.element(toReadBox).not.toBeChecked()
  })

  it('says the most shelves a reader can have, and keeps the name typed', async () => {
    fetchSpy.mockResolvedValue(answer(409, { error: 'quota', scope: 'shelves', max: 50 }))
    await openPicker()
    await nameField.fill('One too many')
    await addButton.click()
    await expect.element(alert).toHaveTextContent('You can have up to 50 shelves.')
    await expect.element(nameField).toHaveValue('One too many')
    await expect.element(picker.getByRole('checkbox', { name: 'One too many' })).not.toBeInTheDocument()
  })

  it('names the shelf the server says the reader already has', async () => {
    fetchSpy.mockResolvedValue(answer(409, { error: 'duplicate' }))
    await openPicker()
    await nameField.fill('Classics')
    await addButton.click()
    await expect.element(alert).toHaveTextContent('You already have a shelf called “Classics”.')
  })

  it('says the book is gone when the server no longer has it', async () => {
    fetchSpy.mockResolvedValue(answer(404, { error: 'not_found' }))
    await openPicker()
    await nameField.fill('Classics')
    await addButton.click()
    await expect.element(alert).toHaveTextContent('This book is no longer available.')
  })

  it('closes on Close, on Escape and on a click outside, giving focus back to the button', async () => {
    await openPicker()
    await picker.getByRole('button', { name: 'Close' }).click()
    await expect.element(picker).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.click()
    await expect.element(favouritesBox).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(picker).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()

    await trigger.click()
    await expect.element(picker).toBeVisible()
    await elsewhere.click()
    await expect.element(picker).not.toBeInTheDocument()

    await trigger.click()
    await trigger.click()
    await expect.element(picker).not.toBeInTheDocument()
  })

  it('keeps Tab and Shift+Tab inside the picker', async () => {
    await openPicker()
    await nameField.fill('Sea')
    const library = picker.getByRole('link', { name: 'Library' })
    await library.element().focus()
    await userEvent.keyboard('{Tab}')
    await expect.element(picker.getByRole('button', { name: 'Close' })).toHaveFocus()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await expect.element(library).toHaveFocus()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    await expect.element(addButton).toHaveFocus()
  })
})
