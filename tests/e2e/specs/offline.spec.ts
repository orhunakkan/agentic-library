import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { isWide } from '../pages'
import { createUser } from '../support/accounts'
import { fakeSpeech, spoken } from '../support/fake-speech'
import { expect, expectAccessible, test } from '../support/fixtures'
import { importViaApi } from '../support/imports'

const BOOK = 'pride-and-prejudice'
const SERIES = 'jane-austen'
const PNG = new Uint8Array(readFileSync(join(import.meta.dirname, '../../fixtures/images/tiny.png')))

const controlled = (page: Page) => page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller))

const appCached = (page: Page) =>
  expect.poll(() => page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('folio-app-')))).toBe(true)

const navigateInApp = (page: Page, href: string) =>
  page.evaluate((to) => {
    history.pushState(history.state, '', to)
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  }, href)

const fullLoad = (page: Page, href: string) => page.evaluate((to) => location.assign(to), href)

const offlineChip = (page: Page) => page.getByText('Offline', { exact: true }).filter({ visible: true })

test.describe('Download for offline', () => {
  test('a reader downloads a book from its page, keeps it across a reload, and removes it', async ({
    page,
    bookPage,
    downloadControl,
  }) => {
    await bookPage.goto(SERIES, BOOK)
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(`**/offline/${BOOK}.json`, async (route) => {
      await held
      await route.continue().catch(() => {})
    })

    await downloadControl.button.click()
    await expect(page.getByText(/^Downloading… \d+%$/)).toBeVisible()
    await expect(downloadControl.cancel).toBeFocused()
    await downloadControl.cancel.click()
    await expect(downloadControl.button).toBeVisible()
    await expect(downloadControl.button).toBeFocused()
    expect(await downloadControl.keptPaths()).toEqual([])

    await downloadControl.button.click()
    await expect(downloadControl.progress).toBeVisible()
    release()
    await expect(downloadControl.downloaded).toBeVisible()
    await expect(page.getByText('Downloaded for offline reading.')).toBeVisible()
    await expect(downloadControl.remove).toBeFocused()
    await expect(page.getByText('Removed when you sign out.')).toHaveCount(0)
    await expectAccessible(page)
    expect(await downloadControl.keptPaths()).toContain(`/offline/${BOOK}.json`)

    await bookPage.goto(SERIES, BOOK)
    await expect(downloadControl.downloaded).toBeVisible()
    await downloadControl.remove.click()
    await expect(page.getByText('Download removed.')).toBeVisible()
    await expect(downloadControl.button).toBeFocused()
    expect((await downloadControl.cacheNames()).filter((name) => !name.startsWith('folio-offline-'))).toEqual([])
  })

  test('an embedded book page offers no download', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'An embed shows the same on every device.')
    await page.goto(`/library/${SERIES}/${BOOK}?iframe=true`)
    await expect(page.getByRole('heading', { level: 1, name: 'Pride and Prejudice' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download for offline' })).toHaveCount(0)
  })

  test('a changed private book’s copy follows it when its reader opens online', async ({
    page,
    baseURL,
    bookPage,
    downloadControl,
    readerPage,
  }) => {
    await createUser(page.request, { signedIn: true })
    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Travel Notes',
      chapters: [
        { title: 'Leaving', text: 'The train left at dawn.' },
        { title: 'Arriving', text: 'The city was still asleep.' },
      ],
    })
    await bookPage.gotoImported(book.id)
    await downloadControl.download()
    await expect(page.getByText('Removed when you sign out.')).toBeVisible()
    expect(await downloadControl.copyField(book.slug, 'title')).toBe('Travel Notes')

    await page.getByLabel('Title').fill('Travel Notes, Revised')
    await page.getByRole('button', { name: 'Save details' }).click()
    await expect(bookPage.heading('Travel Notes, Revised')).toBeVisible()
    await page.goto(book.href)
    await expect(readerPage.content).toContainText('The train left at dawn.')
    await expect.poll(() => downloadControl.copyField(book.slug, 'title')).toBe('Travel Notes, Revised')
  })
})

test.describe('Reading offline', () => {
  test.use({ serviceWorkers: 'allow' })
  test('a downloaded book opens, turns its pages, scrolls and reads aloud with the connection off', async ({
    page,
    context,
    bookPage,
    downloadControl,
    readerPage,
    readAloud,
  }) => {
    await fakeSpeech(page)
    await bookPage.goto(SERIES, BOOK)
    await controlled(page)
    await downloadControl.download()
    await appCached(page)
    await context.setOffline(true)

    await readerPage.goto(BOOK, 'chapter-2', 2)
    await expect(page).toHaveURL(`/read/${BOOK}/chapter-2/2`)
    await expect(readerPage.content).toBeVisible()
    await expect(offlineChip(page)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Ask/ })).toHaveCount(0)
    await expect(readerPage.bookmarkRibbon).toHaveCount(0)
    const highlights = await readerPage.contents.openTab('Highlights')
    await expect(highlights).toHaveText('Highlights show here when you’re back online.')
    if (!isWide(page)) await page.keyboard.press('Escape')
    const bookmarks = await readerPage.contents.openTab('Bookmarks')
    await expect(bookmarks).toHaveText('Bookmarks show here when you’re back online.')
    await expectAccessible(page)
    if (!isWide(page)) await page.keyboard.press('Escape')

    await readerPage.pageLink('Chapter 3').click()
    await expect(page).toHaveURL(`/read/${BOOK}/chapter-3`)
    await expect(readerPage.content).toBeVisible()
    await readerPage.contents.openTab('Contents')
    await readerPage.contents.nav.getByRole('link', { name: /Chapter 4$/ }).click()
    await expect(page).toHaveURL(`/read/${BOOK}/chapter-4`)

    await readerPage.pickSetting('Reading mode', 'Scroll')
    const next = `/read/${BOOK}/chapter-4/2`
    await expect(async () => {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8))
      await expect(readerPage.scrollPage(next)).toBeAttached({ timeout: 250 })
    }).toPass({ timeout: 15_000 })
    await expect(offlineChip(page)).toBeVisible()
    await readerPage.pickSetting('Reading mode', 'Pages')

    await readAloud.start()
    await expect.poll(async () => (await spoken(page))[0]).toMatch(/^Chapter 4\b/)

    const place = await page.evaluate(() => JSON.parse(localStorage.getItem('recent-reading') ?? '[]')[0]?.href)
    expect(place).toMatch(new RegExp(`^/read/${BOOK}/chapter-4`))
    await fullLoad(page, '/library')
    await expect(page.getByRole('heading', { level: 1, name: 'You’re offline' })).toBeVisible()
    const list = page.getByRole('region', { name: 'Downloaded books' })
    await expect(list).toContainText('These open without a connection.')
    await expect(list.getByRole('link', { name: 'Pride and Prejudice' })).toHaveAttribute('href', place)
    await expect(list).toContainText('Jane Austen')
    await expectAccessible(page)
    await list.getByRole('link', { name: 'Pride and Prejudice' }).click()
    await expect(page).toHaveURL(place)
    await expect(readerPage.content).toBeVisible()

    await fullLoad(page, '/read/confessions-of-al-ghazzali/7')
    await expect(page.getByRole('heading', { level: 1, name: 'You’re offline' })).toBeVisible()
    await expect(page.getByText('Folio needs a connection to open this page.', { exact: false })).toBeVisible()
    await readerPage.goto(BOOK, 'chapter-1')
    await navigateInApp(page, '/read/confessions-of-al-ghazzali/7')
    await expect(page.getByText('This book isn’t downloaded on this device.')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'You’re offline' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Downloaded books' })).toHaveAttribute('href', '/offline.html')
    await expectAccessible(page)
  })

  test('a private book’s copy goes at sign-out, and its pictures read offline', async ({
    page,
    context,
    baseURL,
    accountMenu,
    bookPage,
    downloadControl,
    readerPage,
  }) => {
    const user = await createUser(page.request, { signedIn: true })
    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Shared Device',
      chapters: [
        { title: 'Pictures', text: 'A page with a picture on it.' },
        { title: 'Words', text: 'A page of words alone.' },
      ],
      picture: PNG,
    })
    await bookPage.goto(SERIES, BOOK)
    await controlled(page)
    await downloadControl.download()
    await bookPage.gotoImported(book.id)
    await downloadControl.download()
    await expect(page.getByText('Removed when you sign out.')).toBeVisible()
    await appCached(page)

    await context.setOffline(true)
    await page.goto(book.href)
    await expect(readerPage.content).toContainText('A page with a picture on it.')
    await expect
      .poll(() =>
        readerPage.content
          .locator('img')
          .evaluateAll((images) => images.length > 0 && images.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
      )
      .toBe(true)
    await context.setOffline(false)

    await bookPage.goto(SERIES, BOOK)
    await accountMenu.signOut(user.username)
    await page.waitForURL(/\/library$/)
    const kept = await downloadControl.keptPaths()
    expect(kept.filter((p) => p.startsWith('/offline/u-') || p.startsWith('/account/books/'))).toEqual([])
    expect(kept).toContain(`/offline/${BOOK}.json`)
  })
})

test.describe('Headers', () => {
  test('downloads, the shell and the app files are sent as the plan says', { tag: '@http' }, async ({ request }) => {
    const book = await request.get(`/offline/${BOOK}.json`)
    expect(book.status()).toBe(200)
    expect(book.headers()['content-type']).toMatch(/^application\/json/)
    expect(book.headers()['cache-control']).toBe('no-cache')
    expect(await book.json()).toMatchObject({ v: 1, slug: BOOK, owner: null })

    const stranger = await request.get('/offline/u-00000000-0000-4000-8000-000000000000.json')
    expect(stranger.status()).toBe(404)
    expect(stranger.headers()['cache-control']).toBe('private, no-store')

    const crossSite = await request.get(`/offline/${BOOK}.json`, { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(crossSite.status()).toBe(403)

    for (const path of ['/_shell.html', '/app-files.json']) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(200)
      expect(response.headers()['cache-control'], path).toBe('no-cache')
    }
    const figures = await (await request.get('/offline/fixture-figure-book.json')).json()
    expect(figures.pictures.length).toBeGreaterThan(0)
    expect(figures.pictures.every((p: string) => p.startsWith('/images/fixture-figure-book/'))).toBe(true)
    let pictureBytes = 0
    for (const picture of figures.pictures) pictureBytes += (await (await request.get(picture)).body()).length
    expect(figures.bytes).toBeGreaterThan(pictureBytes)

    const manifest = await (await request.get('/app-files.json')).json()
    expect(manifest.files).toContain('/_shell.html')
    expect((await request.get('/index.html')).status()).toBe(404)
  })
})
