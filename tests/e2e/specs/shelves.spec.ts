import type { Page } from '@playwright/test'
import { createUser, signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { importViaApi, postJson } from '../support/imports'

const CODE_BOOK = '/library/code-fixtures/fixture-code-book'
const PROPHET = '/library/poetry-of-the-spirit/the-prophet'

interface Shelf {
  id: string
  name: string
  books: string[]
}

async function makeShelf(page: Page, baseURL: string, name: string, book?: string): Promise<Shelf> {
  const response = await postJson(page.request, baseURL, '/account/shelves/new', book ? { name, book } : { name })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { shelf: Shelf }).shelf
}

async function putOn(page: Page, baseURL: string, id: string, book: string) {
  const response = await postJson(page.request, baseURL, `/account/shelves/${id}/books`, { book, on: true })
  expect(response.status()).toBe(200)
}

test.describe('Your shelves', () => {
  test('make a shelf on a book page, fill it with catalogue and private books, and filter the library by it', async ({
    page,
    baseURL,
    bookPage,
    libraryPage,
  }) => {
    await signedInAt(page, CODE_BOOK)
    await expect(bookPage.shelves.button).toHaveText('Add to shelf')
    await expect(bookPage.shelves.button).toHaveAttribute('aria-haspopup', 'dialog')
    const panel = await bookPage.shelves.open()
    await expect(bookPage.shelves.button).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.getByText('You have no shelves yet. Name one below.')).toBeVisible()
    const name = panel.getByLabel('New shelf')
    await expect(name).toBeFocused()
    await expect(panel.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
    await name.fill('To read')
    await expectAccessible(page)
    await expectNoSideways(page)
    const made = page.waitForResponse((r) => r.url().endsWith('/account/shelves/new'))
    await name.press('Enter')
    expect((await made).status()).toBe(201)
    await expect(panel.getByRole('checkbox', { name: 'To read' })).toBeChecked()
    await expect(name).toHaveValue('')
    await expect(bookPage.shelves.button).toHaveText('On “To read”')
    await expect(bookPage.shelves.button).toHaveAttribute('title', 'On “To read”')

    await page.keyboard.press('Escape')
    await expect(bookPage.shelves.popover).toHaveCount(0)
    await expect(bookPage.shelves.button).toBeFocused()

    await page.goto(PROPHET)
    await bookPage.shelves.open()
    await expect(bookPage.shelves.popover.getByRole('checkbox', { name: 'To read' })).toBeFocused()
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
    expect(await bookPage.shelves.popover.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    const popover = bookPage.shelves.popover
    await expect(popover.getByRole('checkbox', { name: 'To read' })).not.toBeChecked()
    await popover.getByLabel('New shelf').fill('TO RÉAD')
    const add = popover.getByRole('button', { name: 'Add to “To read”' })
    await expect(add).toBeVisible()
    const answered = page.waitForResponse((r) => r.url().includes('/account/shelves/'))
    await add.click()
    expect((await answered).url()).toMatch(/\/books$/)
    await expect(popover.getByRole('checkbox', { name: 'To read' })).toBeChecked()
    await expect(popover.getByRole('checkbox')).toHaveCount(1)
    await page.getByRole('heading', { level: 1 }).click()
    await expect(bookPage.shelves.popover).toHaveCount(0)

    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Shelved Notes',
      chapters: [{ title: 'One', text: 'A private book on a shelf.' }],
    })
    await bookPage.gotoImported(book.id)
    await bookPage.shelves.open()
    expect((await bookPage.shelves.tick('To read')).status()).toBe(200)
    await bookPage.shelves.popover.getByRole('button', { name: 'Close' }).click()
    await expect(bookPage.shelves.button).toBeFocused()

    await libraryPage.goto()
    await expect(libraryPage.chips.getByText('Your shelves')).toBeVisible()
    await libraryPage.chips.getByRole('button', { name: 'To read' }).click()
    await expect(libraryPage.chips.getByRole('button', { name: 'To read' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/filter=shelf-[0-9a-f-]{36}/)
    const row = libraryPage.shelfRow('To read')
    await expect(row.getByText('Your shelf', { exact: true })).toBeVisible()
    await expect(row.getByText('3 books', { exact: true })).toBeVisible()
    expect(await libraryPage.shelfTitles('To read')).toEqual(['Shelved Notes', 'The Prophet', 'A Small Book of Code'])
    await expect(libraryPage.showing(3)).toBeVisible()
    await expect(page.locator('main section')).toHaveCount(1)
    await libraryPage.search.fill('fixtures')
    await expect.poll(() => libraryPage.shelfTitles('To read')).toEqual(['A Small Book of Code'])
    await libraryPage.search.fill('')
    await expectAccessible(page)
    await expectNoSideways(page)
  })

  test('take a book off on its page, and the library shows it gone', async ({
    page,
    baseURL,
    bookPage,
    libraryPage,
  }) => {
    await signedInAt(page, '/library')
    const shelf = await makeShelf(page, baseURL ?? '', 'To read', 'fixture-code-book')
    await putOn(page, baseURL ?? '', shelf.id, 'the-prophet')
    await libraryPage.goto(`?filter=shelf-${shelf.id}`)
    expect(await libraryPage.shelfTitles('To read')).toEqual(['The Prophet', 'A Small Book of Code'])

    await libraryPage
      .shelfRow('To read')
      .getByRole('link', { name: /The Prophet/ })
      .click()
    await expect(page).toHaveURL(PROPHET)
    await bookPage.shelves.open()
    expect((await bookPage.shelves.tick('To read', false)).status()).toBe(200)
    await expect(bookPage.shelves.button).toHaveText('Add to shelf')
    await page.goBack()
    await expect(page).toHaveURL(/filter=shelf-/)
    await expect.poll(() => libraryPage.shelfTitles('To read')).toEqual(['A Small Book of Code'])
    await expect(libraryPage.shelfRow('To read').getByText('1 book', { exact: true })).toBeVisible()
  })

  test('rename and delete a shelf in the library', async ({ page, baseURL, libraryPage }) => {
    await signedInAt(page, '/library')
    const shelf = await makeShelf(page, baseURL ?? '', 'To read', 'fixture-code-book')
    await libraryPage.goto(`?filter=shelf-${shelf.id}`)

    const rename = page.getByRole('button', { name: 'Rename' })
    await rename.click()
    const input = page.getByLabel('Shelf name')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('To read')
    await input.fill('Next up')
    const renamed = page.waitForResponse((r) => r.url().endsWith(`/account/shelves/${shelf.id}`))
    await input.press('Enter')
    await expect(page.getByRole('heading', { level: 2, name: 'Next up', exact: true })).toBeVisible()
    await expect(libraryPage.chips.getByRole('button', { name: 'Next up' })).toBeVisible()
    await expect(rename).toBeFocused()
    expect((await renamed).status()).toBe(200)

    await rename.click()
    await page.getByLabel('Shelf name').fill('Never mind')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { level: 2, name: 'Next up', exact: true })).toBeVisible()
    await expect(rename).toBeFocused()

    await page.getByRole('button', { name: 'Delete' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete “Next up”?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('The books stay in your library.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await expectAccessible(page)
    const deleted = page.waitForResponse((r) => r.url().endsWith(`/account/shelves/${shelf.id}`))
    await dialog.getByRole('button', { name: 'Delete shelf' }).click()
    expect((await deleted).status()).toBe(200)
    await expect(page).not.toHaveURL(/filter=/)
    const all = libraryPage.chips.getByRole('button', { name: 'All', exact: true })
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await expect(all).toBeFocused()
    await expect(libraryPage.chips.getByText('Your shelves')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /A Small Book of Code/ }).first()).toBeVisible()
  })

  test('a refused change says why and is undone', async ({ page, baseURL, bookPage }) => {
    await signedInAt(page, PROPHET)
    await makeShelf(page, baseURL ?? '', 'To read')
    await page.reload()
    const panel = await bookPage.shelves.open()
    const name = panel.getByLabel('New shelf')
    const alert = panel.getByRole('alert')
    await page.route('**/account/shelves/new', (route) =>
      route.fulfill({ status: 409, json: { error: 'quota', scope: 'shelves', max: 50 } }),
    )
    await name.fill('Later')
    await name.press('Enter')
    await expect(alert).toHaveText('You can have up to 50 shelves.')
    await expect(panel.getByRole('checkbox')).toHaveCount(1)
    await expect(name).toHaveValue('Later')

    await page.unrouteAll()
    await page.route('**/account/shelves/new', (route) => route.fulfill({ status: 401, json: { error: 'signed_out' } }))
    await name.press('Enter')
    await expect(alert).toContainText('Your session ended.')
    await expect(alert.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(PROPHET)}`,
    )
  })

  test('a shelf filter is in the server’s page, and only its owner’s', { tag: '@http' }, async ({
    request,
    baseURL,
    playwright,
  }) => {
    await createUser(request, { signedIn: true })
    const made = await postJson(request, baseURL ?? '', '/account/shelves/new', {
      name: 'Server side',
      book: 'fixture-code-book',
    })
    const { shelf } = (await made.json()) as { shelf: Shelf }
    const filtered = `/library?filter=shelf-${shelf.id}`
    const html = await (await request.get(filtered)).text()
    expect(html).toContain('Your shelves')
    expect(html).toContain('Server side')
    expect(html).toContain(`id="shelf-${shelf.id}"`)
    expect(html).toContain('>1 book<')
    expect(await (await request.get(CODE_BOOK)).text()).toContain('Add to shelf')

    await createUser(request, { signedIn: true })
    const peek = await postJson(request, baseURL ?? '', `/account/shelves/${shelf.id}`, { name: 'Mine now' })
    expect(peek.status()).toBe(404)
    expect(await (await request.get(filtered)).text()).not.toContain('Server side')

    const visitor = await playwright.request.newContext({ baseURL })
    try {
      const signedOut = await (await visitor.get(filtered)).text()
      expect(signedOut).not.toContain('Server side')
      expect(signedOut).not.toContain('Your shelves')
      expect(await (await visitor.get(CODE_BOOK)).text()).not.toContain('Add to shelf')
    } finally {
      await visitor.dispose()
    }
  })
})
