import { signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'

const PROPHET = '/library/poetry-of-the-spirit/the-prophet'

test.describe('Remove from library', () => {
  test('remove a book on its page, find it gone everywhere it was listed, and restore it from the library', async ({
    page,
    bookPage,
    libraryPage,
  }) => {
    await signedInAt(page, PROPHET)
    await expect(bookPage.removeButton).toBeVisible()
    const input = page.getByRole('combobox', { name: 'Search books, series and chapters' })
    await page.keyboard.press('Control+k')
    await input.fill('self-knowledge')
    await expect(page.getByRole('option', { name: /On Self-Knowledge/ }).first()).toBeVisible()
    await page.keyboard.press('Escape')

    const saved = page.waitForResponse((r) => r.url().endsWith('/account/removed-books'))
    await bookPage.removeButton.click()
    expect((await saved).status()).toBe(200)
    await expect(bookPage.restoreButton).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Removed from your library.' })).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)

    await page.keyboard.press('Control+k')
    await input.fill('self-knowledge')
    await expect(page.getByRole('option', { name: /On Self-Knowledge/ })).toHaveCount(0)
    await input.fill('The Prophet')
    await expect(page.getByRole('option', { name: /The Prophet/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.reload()
    await expect(bookPage.heading('The Prophet')).toBeVisible()
    await expect(bookPage.restoreButton).toBeVisible()
    await expect(bookPage.startReading).toBeVisible()

    await libraryPage.goto()
    await expect(libraryPage.shelf('poetry-of-the-spirit')).toHaveCount(0)
    await expect(libraryPage.chips.getByRole('button', { name: 'Classics of Wisdom' })).toHaveCount(0)
    await libraryPage.search.fill('Prophet')
    await expect(page.getByText('No results for “Prophet”. Try another word.')).toBeVisible()
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(libraryPage.removedBooks).toBeVisible()
    await expect(libraryPage.removedBooks.getByRole('link', { name: 'The Prophet' })).toHaveAttribute('href', PROPHET)
    await expectAccessible(page)
    await expectNoSideways(page)

    const nav = await libraryPage.nav.open()
    await expect(nav.getByRole('link', { name: /Poetry of the Spirit/ })).toHaveCount(0)
    if (!libraryPage.nav.hasSidebar) await page.keyboard.press('Escape')

    await page.goto('/library/poetry-of-the-spirit')
    await expect(page.getByText('You removed every book in this series.')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Poetry of the Spirit' })).toBeVisible()
    await expectAccessible(page)
    await page.getByRole('link', { name: 'See removed books' }).click()
    await expect(page).toHaveURL('/library#removed-books')

    await libraryPage.removedBooks.getByRole('button', { name: 'Restore The Prophet' }).click()
    await expect(libraryPage.removedBooks).toHaveCount(0)
    await expect(libraryPage.shelf('poetry-of-the-spirit').getByRole('link', { name: /The Prophet/ })).toBeVisible()
    await expect(libraryPage.chips.getByRole('button', { name: 'Classics of Wisdom' })).toBeVisible()

    await page.goto(PROPHET)
    await expect(bookPage.removeButton).toBeVisible()
    await page.keyboard.press('Control+k')
    await input.fill('The Prophet')
    await expect(page.getByRole('option', { name: /The Prophet/ }).first()).toBeVisible()
  })

  test('a refused change is undone and says why', async ({ page, bookPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'What is said and undone is the same on every device.')
    await signedInAt(page, PROPHET)
    await page.route('**/account/removed-books', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'failed' }) }),
    )
    await bookPage.removeButton.click()
    await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t save that. Try again.' })).toBeVisible()
    await expect(bookPage.removeButton).toBeVisible()

    await page.route('**/account/removed-books', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'signed_out' }) }),
    )
    await bookPage.removeButton.click()
    const alert = page.getByRole('alert').filter({ hasText: 'Your session ended.' })
    await expect(alert).toBeVisible()
    await expect(alert.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /next=/)
  })
})
