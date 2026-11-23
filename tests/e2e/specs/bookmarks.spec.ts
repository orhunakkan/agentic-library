import type { Locator } from '@playwright/test'
import { isWide, press } from '../pages'
import { signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { importViaApi } from '../support/imports'
import { serverFnUrl } from '../support/server-fns'

const PAGE = '/read/pride-and-prejudice/chapter-6/2'
const PAGED = '/read/confessions-of-al-ghazzali/39'

test.describe('Bookmarks in the reader', () => {
  test('signed out: the ribbon opens the tab with why, sends nothing, and Sign in links back here', async ({
    page,
    readerPage,
  }) => {
    const sent: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/account/bookmarks/')) sent.push(r.url())
    })
    await page.goto(PAGE)
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('aria-pressed', 'false')
    await press(page, readerPage.bookmarkRibbon)
    const tab = readerPage.contents.tabPanel('Bookmarks')
    await expect(tab.getByText('Sign in to bookmark pages in this book.')).toBeVisible()
    await expect(tab.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(PAGE)}`,
    )
    expect(sent).toEqual([])
  })

  test('bookmark a page, keep it after a reload, come back to it from the tab, and remove it', async ({
    page,
    readerPage,
  }) => {
    await signedInAt(page, PAGE)
    expect((await readerPage.toggleBookmark()).status()).toBe(201)
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('aria-pressed', 'true')
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('title', 'Remove bookmark')
    await expect(page.getByText('Page bookmarked', { exact: true })).toBeVisible()

    await page.reload()
    await expect(readerPage.bookmarkRibbon).toBeEnabled()
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('aria-pressed', 'true')

    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('aria-pressed', 'false')
    await expect(readerPage.bookmarkRibbon).toBeEnabled()
    const tab = await readerPage.contents.openTab('Bookmarks')
    await expect(readerPage.contents.tab('Bookmarks')).toHaveAccessibleName('Bookmarks 1')
    const entry = tab.getByRole('link', { name: /Ch\. 6 · p\. 2/ })
    await expect(entry).toContainText('6. Chapter 6')
    await press(page, entry)
    await expect(page).toHaveURL(PAGE)
    if (!isWide(page)) await expect(page.getByRole('dialog')).toBeHidden()
    const back = await readerPage.contents.openTab('Bookmarks')
    await expect(back.getByRole('link', { name: /Ch\. 6 · p\. 2/ })).toHaveAttribute('aria-current', 'page')
    await expect(back.getByText('This page', { exact: true })).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)

    const removed = page.waitForResponse((r) => /\/account\/bookmarks\/[0-9a-f-]{36}$/.test(r.url()))
    await press(page, back.getByRole('button', { name: 'Remove bookmark, Ch. 6 · p. 2' }))
    expect((await removed).status()).toBe(200)
    await expect(
      back.getByText(
        'No bookmarks yet. Press the ribbon at the top of a page to bookmark it, or Bookmark in the player to mark a moment while listening.',
      ),
    ).toBeVisible()
    if (!isWide(page)) await page.keyboard.press('Escape')
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('aria-pressed', 'false')

    expect((await readerPage.toggleBookmark()).status()).toBe(201)
    expect((await readerPage.toggleBookmark('id')).status()).toBe(200)
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('Bookmark removed', { exact: true }).last()).toBeVisible()
  })

  test('the ribbon waits for the list, and a list that couldn’t load says so until Retry loads it', async ({
    page,
    readerPage,
  }) => {
    await signedInAt(page, PAGE)
    const read = serverFnUrl('src/server/account-functions.ts', 'getBookBookmarks')
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const asked = page.waitForRequest(read)
    await page.route(read, async (route) => {
      await held
      await route.abort('failed')
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await asked
    await expect(readerPage.bookmarkRibbon).toBeDisabled()
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('title', 'Loading your bookmarks…')

    release()
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('title', 'Your bookmarks couldn’t be loaded')
    await expect(readerPage.bookmarkRibbon).toBeDisabled()
    const tab = await readerPage.contents.openTab('Bookmarks')
    await expect(tab.getByText('Your bookmarks couldn’t be loaded.')).toBeVisible()
    await expectAccessible(page)

    await page.unroute(read)
    await press(page, tab.getByRole('button', { name: 'Retry' }))
    await expect(tab.getByText(/^No bookmarks yet\./)).toBeVisible()
    if (!isWide(page)) await page.keyboard.press('Escape')
    await expect(readerPage.bookmarkRibbon).toBeEnabled()
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('title', 'Bookmark this page')
  })

  test('a paged book and a private book: each page bookmarks', async ({ page, baseURL, readerPage }) => {
    await signedInAt(page, PAGED)
    expect((await readerPage.toggleBookmark()).status()).toBe(201)
    const pagedTab = await readerPage.contents.openTab('Bookmarks')
    await expect(pagedTab.getByRole('link', { name: /p\. 39/ })).toBeVisible()

    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Private Margins',
      chapters: [{ title: 'Only Chapter', text: 'A private page that only its owner may bookmark.' }],
    })
    await page.goto(book.href)
    expect((await readerPage.toggleBookmark()).status()).toBe(201)
    const privateTab = await readerPage.contents.openTab('Bookmarks')
    await expect(privateTab.getByRole('link', { name: /Ch\. 1 · p\. 1/ })).toContainText('A private page')
  })

  test('keyboard only: Tab reaches the ribbon, Space toggles it, and Remove works from the tab', async ({
    page,
    readerPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard reading on a desktop browser.')
    await signedInAt(page, PAGE)
    await expect(readerPage.bookmarkRibbon).toBeEnabled()
    await page.getByRole('link', { name: 'Skip to content' }).focus()
    await page.keyboard.press('Enter')
    await expect(readerPage.content).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(readerPage.bookmarkRibbon).toBeFocused()
    const saved = page.waitForResponse((r) => r.url().endsWith('/account/bookmarks/new'))
    await page.keyboard.press('Space')
    expect((await saved).status()).toBe(201)
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('aria-pressed', 'true')
    await expect(readerPage.bookmarkRibbon).toBeFocused()

    const contentsTab = page.getByRole('tab', { name: 'Contents' })
    for (let i = 0; i < 80 && !(await contentsTab.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Shift+Tab')
    await expect(contentsTab).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(readerPage.contents.tabPanel('Bookmarks')).toBeVisible()
    const remove = readerPage.contents
      .tabPanel('Bookmarks')
      .getByRole('button', { name: 'Remove bookmark, Ch. 6 · p. 2' })
    for (let i = 0; i < 10 && !(await remove.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab')
    await expect(remove).toBeFocused()
    const removed = page.waitForResponse((r) => /\/account\/bookmarks\/[0-9a-f-]{36}$/.test(r.url()))
    await page.keyboard.press('Enter')
    expect((await removed).status()).toBe(200)
    await expect(readerPage.bookmarkRibbon).toHaveAttribute('aria-pressed', 'false')
  })

  test('embedded: no ribbon and no Bookmarks tab', async ({ page, readerPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'An embed shows the same on every device.')
    await signedInAt(page, PAGE)
    await page.goto(`${PAGE}?iframe=true`)
    await expect(readerPage.content).toBeVisible()
    await expect(readerPage.bookmarkRibbon).toHaveCount(0)
    await expect(readerPage.contents.tab('Bookmarks')).toHaveCount(0)
  })

  test('the three tabs fit the rail and a 360px drawer, counts and all', async ({ page, readerPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Measured once, on desktop, then at 360px.')
    await signedInAt(page, PAGE)
    expect((await readerPage.toggleBookmark()).status()).toBe(201)
    await readerPage.goto('pride-and-prejudice', 'chapter-6', 3)
    expect((await readerPage.toggleBookmark()).status()).toBe(201)

    const fits = async (scope: Locator) => {
      const tabs = scope.getByRole('tab')
      await expect(tabs).toHaveCount(3)
      for (const tab of await tabs.all()) {
        await expect(tab).toBeVisible()
        const label = tab.locator('span').first()
        const [scroll, client] = await label.evaluate((el) => [el.scrollWidth, el.clientWidth])
        expect(scroll, `${await tab.textContent()} is clipped`).toBeLessThanOrEqual(client)
      }
      await expect(scope.getByRole('tab', { name: 'Bookmarks 2' })).toBeVisible()
    }
    await fits(readerPage.contents.panel)

    await page.setViewportSize({ width: 360, height: 780 })
    await readerPage.contents.toolbarButton.click()
    await fits(page.getByRole('dialog'))
    await expectNoSideways(page)
  })
})
