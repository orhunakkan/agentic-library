import { readFileSync } from 'node:fs'
import { request as playwrightRequest } from '@playwright/test'
import type { BookPage } from '../pages'
import { createUser, signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, hydrated, imageLoaded, test } from '../support/fixtures'
import { importViaApi } from '../support/imports'

const image = (name: string) => readFileSync(new URL(`../../fixtures/images/${name}`, import.meta.url))

async function readerWithBook(bookPage: BookPage, baseURL: string, title: string) {
  const { page } = bookPage
  const user = await signedInAt(page)
  const book = await importViaApi(page.request, baseURL, {
    title,
    chapters: [
      { title: 'Morning', text: 'The first chapter.' },
      { title: 'Evening', text: 'The second chapter.' },
    ],
  })
  await bookPage.gotoImported(book.id)
  await hydrated(page)
  return { user, book }
}

test.describe('Catalogue covers', () => {
  test('Pride and Prejudice shows its own cover, and the generated one when it fails', async ({
    page,
    bookPage,
    libraryPage,
    readerPage,
  }) => {
    const src = /\/covers\/pride-and-prejudice-[0-9a-f]{8}\.jpg$/
    await libraryPage.goto()
    const card = page
      .getByRole('link', { name: /Pride and Prejudice/ })
      .first()
      .locator('img')
    await expect(card).toHaveAttribute('src', src)
    await imageLoaded(card)

    await bookPage.goto('jane-austen', 'pride-and-prejudice')
    const header = bookPage.cover.locator('img')
    await expect(header).toHaveAttribute('src', src)
    await expect(header).toHaveAttribute('fetchpriority', 'high')
    await expect(header).toHaveAttribute('alt', '')
    await imageLoaded(header)

    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    await hydrated(page)
    await libraryPage.goto()
    const resume = libraryPage.continueReading.locator('.cover img').first()
    await expect(resume).toHaveAttribute('src', src)
    await imageLoaded(resume)

    await page.route(/\/covers\/pride-and-prejudice-[0-9a-f]{8}\.jpg$/, (route) => route.fulfill({ status: 404 }))
    await bookPage.goto('jane-austen', 'pride-and-prejudice')
    await expect(bookPage.cover.locator('svg')).toBeVisible()
    await expect(bookPage.cover.locator('img')).toHaveCount(0)
  })

  test('the cover addresses answer as they should @http', async ({ request }) => {
    const svg = await request.get('/covers/pride-and-prejudice.svg')
    expect(svg.headers()['content-type']).toContain('image/svg+xml')
    const bare = await request.get('/covers/pride-and-prejudice', { maxRedirects: 0 })
    expect(bare.status()).toBe(302)
    const location = bare.headers().location ?? ''
    expect(location).toMatch(/^\/covers\/pride-and-prejudice-[0-9a-f]{8}\.jpg$/)
    const jpeg = await request.get(location)
    expect(jpeg.headers()['content-type']).toBe('image/jpeg')
    expect(jpeg.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
    const stale = await request.get('/covers/pride-and-prejudice-00000000.jpg', { maxRedirects: 0 })
    expect([stale.status(), stale.headers().location]).toEqual([302, location])
  })
})

test.describe('The book page', () => {
  test('choosing an image, refusing a tiny one, and going back to the generated cover', async ({
    page,
    baseURL,
    bookPage,
  }) => {
    await readerWithBook(bookPage, baseURL ?? '', 'Garden Notes')
    await expect(page.getByText('This book has no cover yet.')).toBeVisible()
    await expect(bookPage.cover.locator('svg')).toBeVisible()
    await expect(page.getByText('Generated from the title')).toBeVisible()

    const details = bookPage.details
    await details
      .getByLabel('Choose an image…')
      .setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: image('wide.png') })
    await expect(page.getByRole('status').filter({ hasText: 'Cover saved.' })).toBeVisible()
    await imageLoaded(bookPage.cover.locator('img'))
    await expect(details.getByText('Your image')).toBeVisible()
    await expect(page.getByText('This book has no cover yet.')).toHaveCount(0)

    await details
      .getByLabel('Choose an image…')
      .setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: image('tiny.png') })
    await expect(details.getByRole('alert')).toHaveText('That image is too small. Choose one at least 64 pixels wide.')
    await details
      .getByLabel('Choose an image…')
      .setInputFiles({ name: 'note.png', mimeType: 'image/png', buffer: image('not-an-image.jpg') })
    await expect(details.getByRole('alert')).toHaveText(
      'That image couldn’t be read. Choose a JPEG, PNG or WebP image.',
    )
    await imageLoaded(bookPage.cover.locator('img'))

    await details.getByRole('button', { name: 'Use the generated cover' }).click()
    await expect(page.getByRole('main').getByText('The generated cover is back.')).toBeVisible()
    await expect(bookPage.cover.locator('svg')).toBeVisible()
    await expectNoSideways(page)
  })

  test('finding a cover and details on Open Library', async ({ page, baseURL, bookPage }) => {
    await readerWithBook(bookPage, baseURL ?? '', 'Field Notes')
    await page
      .getByRole('complementary', { name: 'No cover yet' })
      .getByRole('button', { name: 'Find cover and details' })
      .click()
    const panel = bookPage.findPanel
    await expect(panel).toContainText(
      'Folio’s server sends the title and author, or the ISBN, below to Open Library to look for matches.',
    )
    await expect(panel.getByLabel('Title')).toHaveValue('Field Notes')
    await expect(panel.getByLabel('Author')).toHaveValue('API Tester')

    await panel.getByLabel('Title').fill('Pride and Prejudice')
    await panel.getByLabel('Title').press('Enter')
    await expect(panel.getByRole('status')).toHaveText('5 matches')
    const thumb = panel.getByRole('listitem').first().locator('img')
    await expect(thumb).toHaveAttribute('src', /\/test-open-library\/covers\/b\/id\/14348537-M\.jpg$/)
    await expect(thumb).toHaveAttribute('referrerpolicy', 'no-referrer')
    await imageLoaded(thumb)
    await expect(panel.getByRole('checkbox', { name: 'Use its cover' })).toBeChecked()
    await expect(panel.getByRole('checkbox', { name: 'Use its description' })).toBeChecked()
    await expectAccessible(page)

    await panel.getByRole('button', { name: 'Use this match for Pride and Prejudice' }).first().click()
    await expect(page.getByRole('status').filter({ hasText: 'Cover and description added.' })).toBeVisible()
    await expect(panel).toHaveCount(0)
    await expect(page.locator('#details-title')).toBeFocused()
    await imageLoaded(bookPage.cover.locator('img'))
    const about = bookPage.about
    await expect(about).toContainText('Pride and Prejudice is an 1813 novel of manners')
    await expect(about.getByRole('link', { name: 'Details from Open Library' })).toHaveAttribute(
      'href',
      'https://openlibrary.org/works/OL66554W',
    )
    await expect(page.getByRole('definition').filter({ hasText: '1813' })).toBeVisible()
    await expect(bookPage.details.getByRole('link', { name: 'Cover from Open Library' })).toBeVisible()
  })

  test('Find cover and details works from the keyboard, and Escape closes it', async ({
    page,
    baseURL,
    bookPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard order, once; the touch layout is covered above.')
    await readerWithBook(bookPage, baseURL ?? '', 'Keyboard Notes')
    const find = bookPage.details.getByRole('button', { name: 'Find cover and details' })
    await find.focus()
    await page.keyboard.press('Enter')
    const panel = bookPage.findPanel
    await expect(panel.getByLabel('Title')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(find).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(panel.getByLabel('Title')).toBeFocused()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Pride and Prejudice')
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('status')).toHaveText('5 matches')
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab')
      const text = await page.evaluate(() => document.activeElement?.textContent ?? '')
      if (text.startsWith('Use this match')) break
    }
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: 'Cover and description added.' })).toBeVisible()
  })
})

test.describe('The book page without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('renders, saves details and goes back to the generated cover', async ({ page, baseURL, bookPage }) => {
    await createUser(page.request, { signedIn: true })
    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Plain Book',
      chapters: [{ title: 'One', text: 'Text.' }],
    })
    const origin = new URL(baseURL ?? '').origin
    const upload = await page.request.post(`/account/books/${book.id}/cover`, {
      data: image('cover.jpg'),
      headers: { origin, 'content-type': 'image/jpeg' },
    })
    expect(upload.status()).toBe(200)

    await bookPage.gotoImported(book.id)
    await expect(bookPage.heading('Plain Book')).toBeVisible()
    await expect(page.getByText('Choosing an image and finding details need JavaScript.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Find cover and details' })).toHaveCount(0)
    await expect(page.getByText('No description yet.')).toBeVisible()

    await page.getByLabel('Description').fill('Written without JavaScript.')
    await page.getByLabel('Publisher').fill('Plain Press')
    await page.getByRole('button', { name: 'Save details' }).click()
    await expect(page.getByRole('main').getByText('Details saved.')).toBeVisible()
    await expect(bookPage.about).toContainText('Written without JavaScript.')
    await expect(page.getByRole('definition').filter({ hasText: 'Plain Press' })).toBeVisible()

    await page.getByRole('button', { name: 'Use the generated cover' }).click()
    await expect(page.getByRole('main').getByText('The generated cover is back.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use the generated cover' })).toHaveCount(0)
  })
})

test.describe('Private, always', () => {
  test('another reader gets a 404 for the page, which is never cached; /account/books/lookup is not a book', {
    tag: '@http',
  }, async ({ request, baseURL }) => {
    const base = baseURL ?? ''
    const origin = new URL(base).origin
    const owner = await playwrightRequest.newContext({ baseURL: base })
    const other = await playwrightRequest.newContext({ baseURL: base })
    try {
      await createUser(owner, { signedIn: true })
      await createUser(other, { signedIn: true })
      const book = await importViaApi(owner, base, {
        title: 'Owner Only',
        chapters: [{ title: 'Morning', text: 'The first chapter.' }],
      })
      const own = await owner.get(`/account/books/${book.id}`)
      expect([own.status(), own.headers()['cache-control']]).toEqual([200, 'private, no-store'])
      const theirs = await other.get(`/account/books/${book.id}`)
      expect([theirs.status(), theirs.headers()['cache-control']]).toEqual([404, 'private, no-store'])

      const signedOut = await request.post('/account/books/lookup', {
        data: JSON.stringify({ book: book.id, title: 'x' }),
        headers: { origin, 'content-type': 'application/json' },
      })
      expect([signedOut.status(), await signedOut.json()]).toEqual([401, { error: 'signed_out' }])
    } finally {
      await owner.dispose()
      await other.dispose()
    }
  })
})
