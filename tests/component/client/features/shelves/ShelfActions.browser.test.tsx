import { beforeEach, describe, expect, it, type Mock, type MockInstance, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ShelfActions } from '~/client/features/shelves/ShelfActions'
import { useShelves } from '~/client/features/shelves/use-shelves'
import { isObject } from '~/shared/lib/json-shape'
import type { ShelfAnswer, ShelfDeletedAnswer, ShelfErrorAnswer, ShelfView } from '~/shared/shelves/contract'
import { mountAt } from '../../../../support/client/router'

/** The hook loads the shelves itself only when the page has none; these tests always give it the page's list. */
vi.mock('~/server/account-functions', () => ({ getShelves: vi.fn() }))

const TO_READ = {
  id: '6f1c0000-0000-4000-8000-000000000001',
  name: 'To read',
  books: ['moby-dick'],
} satisfies ShelfView
const FAVOURITES = { id: '6f1c0000-0000-4000-8000-000000000002', name: 'Favourites', books: [] } satisfies ShelfView
const SHELVES: readonly ShelfView[] = [TO_READ, FAVOURITES]

const changeUrl = `/account/shelves/${TO_READ.id}`

/** The shelf endpoint's answers, typed by its contract so a renamed code or field fails the typecheck. */
const answer = (status: number, body: ShelfAnswer | ShelfDeletedAnswer | ShelfErrorAnswer) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

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

/** Each shelf as the library page shows it: a section named by its heading, with the actions and notice inside. */
function Shelves({ onDeleted }: { onDeleted: (name: string) => void }) {
  const api = useShelves({ initial: SHELVES })
  return api.shelves.map((shelf) => {
    const titleId = `shelf-${shelf.id}-title`
    return (
      <section key={shelf.key} aria-labelledby={titleId}>
        <ShelfActions shelf={shelf} titleId={titleId} api={api} onDeleted={() => onDeleted(shelf.name)}>
          {({ heading, actions, notice }) => (
            <>
              {heading}
              {actions}
              {notice}
            </>
          )}
        </ShelfActions>
      </section>
    )
  })
}

/** What the page is told when a shelf is deleted: the name of the shelf. */
let onDeleted: Mock<(name: string) => void>

const mountShelves = async () => {
  onDeleted = vi.fn<(name: string) => void>()
  await mountAt('/library', <Shelves onDeleted={onDeleted} />, { viewer: { username: 'reader' } })
}

const toRead = page.getByRole('region', { name: 'To read' })
const renameButton = toRead.getByRole('button', { name: 'Rename' })
const deleteButton = toRead.getByRole('button', { name: 'Delete' })
const nameField = page.getByRole('textbox', { name: 'Shelf name' })
const save = page.getByRole('button', { name: 'Save' })
const renameError = page.getByRole('alert')
const confirm = page.getByRole('dialog', { name: 'Delete “To read”?' })

async function startRename() {
  await mountShelves()
  await renameButton.click()
  await expect.element(nameField).toHaveFocus()
}

describe('ShelfActions: renaming', () => {
  it('shows the shelf’s name as its heading, with Rename and Delete', async () => {
    await mountShelves()
    await expect.element(toRead.getByRole('heading', { name: 'To read', level: 2 })).toBeVisible()
    await expect.element(renameButton).toBeVisible()
    await expect.element(deleteButton).toBeVisible()
  })

  it('renames the shelf, showing the new name at once and giving focus back to Rename', async () => {
    const kept = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(kept.promise)
    await startRename()
    await expect.element(nameField).toHaveValue('To read')
    await expect.element(nameField).toHaveSelection('To read')
    await nameField.fill('  Up   next ')
    await save.click()

    const upNext = page.getByRole('region', { name: 'Up next' })
    await expect.element(upNext.getByRole('heading', { name: 'Up next' })).toBeVisible()
    await expect.element(upNext.getByRole('button', { name: 'Rename' })).toHaveFocus()
    expect(sent()).toEqual([[changeUrl, { name: 'Up next' }]])
    kept.resolve(answer(200, { shelf: { ...TO_READ, name: 'Up next' } }))
    await expect.element(upNext.getByRole('heading', { name: 'Up next' })).toBeVisible()
  })

  it('can’t save an empty name', async () => {
    await startRename()
    await nameField.fill('   ')
    await expect.element(save).toBeDisabled()
    await userEvent.keyboard('{Enter}')
    await expect.element(nameField).toBeVisible()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('closes without sending when the name is the same, or on Cancel or Escape', async () => {
    await startRename()
    await save.click()
    await expect.element(nameField).not.toBeInTheDocument()

    await renameButton.click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(nameField).not.toBeInTheDocument()
    await expect.element(renameButton).toHaveFocus()

    await renameButton.click()
    await nameField.fill('Something else')
    await userEvent.keyboard('{Escape}')
    await expect.element(nameField).not.toBeInTheDocument()
    await expect.element(toRead.getByRole('heading', { name: 'To read' })).toBeVisible()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('stops a name another shelf has, without asking the server, until the name changes', async () => {
    await startRename()
    await nameField.fill('favourites')
    await save.click()
    await expect.element(renameError).toHaveTextContent('You already have a shelf called “Favourites”.')
    await expect.element(nameField).toHaveAttribute('aria-invalid', 'true')
    await expect.element(nameField).toHaveAccessibleDescription('You already have a shelf called “Favourites”.')
    expect(fetchSpy).not.toHaveBeenCalled()

    await nameField.fill('Favourite books')
    await expect.element(renameError).not.toBeInTheDocument()
    await expect.element(nameField).not.toHaveAttribute('aria-invalid')
  })

  it('opens the rename again with what was typed when the server has that name already', async () => {
    fetchSpy.mockResolvedValue(answer(409, { error: 'duplicate' }))
    await startRename()
    await nameField.fill('Classics ')
    await save.click()
    await expect.element(renameError).toHaveTextContent('You already have a shelf called “Classics”.')
    await expect.element(nameField).toHaveValue('Classics ')
    await expect.element(page.getByRole('heading', { name: 'Classics' })).not.toBeInTheDocument()
  })

  it('says a session that ended', async () => {
    fetchSpy.mockResolvedValue(answer(401, { error: 'signed_out' }))
    await startRename()
    await nameField.fill('Up next')
    await save.click()
    await expect.element(renameError).toHaveTextContent('Your session ended.')
    await expect.element(nameField).toHaveValue('Up next')
  })

  it('puts the old name back when the server fails, and says to try again', async () => {
    fetchSpy.mockResolvedValue(answer(500, { error: 'failed' }))
    await startRename()
    await nameField.fill('Up next')
    await save.click()
    await expect.element(renameError).toHaveTextContent('Couldn’t save that. Try again.')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(toRead.getByRole('heading', { name: 'To read' })).toBeVisible()
  })

  it('says to try again when the reader is offline', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'))
    await startRename()
    await nameField.fill('Up next')
    await save.click()
    await expect.element(renameError).toHaveTextContent('Couldn’t save that. Try again.')
  })

  it('drops a shelf another device deleted, without an error', async () => {
    fetchSpy.mockResolvedValue(answer(404, { error: 'not_found' }))
    await startRename()
    await nameField.fill('Up next')
    await save.click()
    await expect.element(page.getByRole('region', { name: 'Up next' })).not.toBeInTheDocument()
    await expect.element(toRead).not.toBeInTheDocument()
    await expect.element(page.getByRole('region', { name: 'Favourites' })).toBeVisible()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ShelfActions: deleting', () => {
  it('asks first, with Cancel focused, and Cancel or Escape keeps the shelf', async () => {
    await mountShelves()
    await deleteButton.click()
    await expect.element(confirm).toBeVisible()
    await expect.element(confirm).toHaveAccessibleDescription('The books stay in your library.')
    const cancel = confirm.getByRole('button', { name: 'Cancel' })
    await expect.element(cancel).toHaveFocus()
    await cancel.click()
    await expect.element(confirm).not.toBeInTheDocument()
    await expect.element(deleteButton).toHaveFocus()

    await deleteButton.click()
    await expect.element(confirm).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(confirm).not.toBeInTheDocument()
    await expect.element(deleteButton).toHaveFocus()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('deletes the shelf once the server has, then tells the page', async () => {
    const deleted = Promise.withResolvers<Response>()
    fetchSpy.mockReturnValue(deleted.promise)
    await mountShelves()
    await deleteButton.click()
    const deleteShelf = confirm.getByRole('button', { name: 'Delete shelf' })
    await deleteShelf.click()
    await expect.element(deleteShelf).toBeDisabled()
    expect(sent()).toEqual([[changeUrl, { intent: 'delete' }]])
    expect(onDeleted).not.toHaveBeenCalled()

    deleted.resolve(answer(200, { deleted: true }))
    await expect.element(toRead).not.toBeInTheDocument()
    expect(onDeleted).toHaveBeenCalledExactlyOnceWith('To read')
  })

  it('counts a shelf another device deleted as deleted', async () => {
    fetchSpy.mockResolvedValue(answer(404, { error: 'not_found' }))
    await mountShelves()
    await deleteButton.click()
    await confirm.getByRole('button', { name: 'Delete shelf' }).click()
    await expect.element(toRead).not.toBeInTheDocument()
    expect(onDeleted).toHaveBeenCalledExactlyOnceWith('To read')
  })

  it.each([
    ['the server fails', () => answer(500, { error: 'failed' })],
    ['the session ended', () => answer(401, { error: 'signed_out' })],
  ])('keeps the shelf and says to try again when %s', async (_, reply) => {
    fetchSpy.mockResolvedValue(reply())
    await mountShelves()
    await deleteButton.click()
    await confirm.getByRole('button', { name: 'Delete shelf' }).click()
    const notice = toRead.getByRole('alert')
    await expect.element(notice).toHaveTextContent('Couldn’t delete the shelf. Try again.')
    await expect.element(confirm).not.toBeInTheDocument()
    await expect.element(deleteButton).toHaveFocus()
    expect(onDeleted).not.toHaveBeenCalled()

    await renameButton.click()
    await expect.element(notice).not.toBeInTheDocument()
  })

  it('keeps the shelf when the reader is offline, and clears the notice on the next Delete', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'))
    await mountShelves()
    await deleteButton.click()
    await confirm.getByRole('button', { name: 'Delete shelf' }).click()
    const notice = toRead.getByRole('alert')
    await expect.element(notice).toHaveTextContent('Couldn’t delete the shelf. Try again.')
    await expect.element(toRead.getByRole('heading', { name: 'To read' })).toBeVisible()

    await deleteButton.click()
    await expect.element(notice).not.toBeInTheDocument()
  })
})
