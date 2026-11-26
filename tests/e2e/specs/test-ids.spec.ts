import type { Page } from '@playwright/test'
import { createUser } from '../support/accounts'
import { expect, test } from '../support/fixtures'
import { importViaApi } from '../support/imports'
import { elementsWithoutTestId } from '../support/test-ids'

async function expectTestIds(page: Page, where: string) {
  expect(await elementsWithoutTestId(page), `elements without a data-testid on ${where}`).toEqual([])
  await expect(page.locator('h1[data-testid]').first(), `the h1 on ${where}`).toBeAttached()
}

const PUBLIC_PAGES = [
  '/',
  '/library',
  '/library/jane-austen',
  '/library/jane-austen/pride-and-prejudice',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/confirm-email',
  '/privacy',
  '/terms',
  '/credits',
  '/no-such-page',
]

const ACCOUNT_PAGES = [
  '/library',
  '/account',
  '/account/books',
  '/account/highlights',
  '/account/stats',
  '/account/flashcards',
  '/account/prompts',
  '/account/api-keys',
  '/account/users',
]

test.describe('data-testid contract', () => {
  test('every public page', async ({ page }) => {
    for (const path of PUBLIC_PAGES) {
      await page.goto(path)
      await expectTestIds(page, path)
    }
  })

  test("every account page, and an imported book's", async ({ page, baseURL }) => {
    await createUser(page.request, { role: 'admin', signedIn: true })
    for (const path of ACCOUNT_PAGES) {
      await page.goto(path)
      await expectTestIds(page, path)
    }
    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Test Id Notes',
      chapters: [
        { title: 'First entry', text: 'A short first entry.' },
        { title: 'Second entry', text: 'A short second entry.' },
      ],
    })
    await page.goto(`/account/books/${book.id}`)
    await expectTestIds(page, 'a private book')
  })

  test('the reader, with its panels and dialogs open', async ({ page, readerPage, siteNav }) => {
    await createUser(page.request, { signedIn: true })
    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    await expectTestIds(page, 'the reader')

    for (const tab of ['Highlights', 'Bookmarks']) {
      await readerPage.contents.openTab(tab)
      await expectTestIds(page, `the reader's ${tab} tab`)
    }
    await readerPage.settingsButton.click()
    await expect(readerPage.settings).toBeVisible()
    await expectTestIds(page, 'reading settings')
    await page.keyboard.press('Escape')

    await readerPage.ask.open()
    await expectTestIds(page, 'Ask this book')
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+k')
    await expect(page.getByRole('dialog', { name: 'Search the library' })).toBeVisible()
    await expectTestIds(page, 'the search palette')
    await page.keyboard.press('Escape')

    await siteNav.open()
    await expectTestIds(page, 'the menu drawer')
  })
})
