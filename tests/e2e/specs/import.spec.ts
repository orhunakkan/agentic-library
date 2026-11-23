import { type APIRequestContext, type Page, request as playwrightRequest } from '@playwright/test'
import type { ImportPage } from '../pages'
import { createUser, signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, hydrated, imageLoaded, test } from '../support/fixtures'
import { FIXTURE, importViaApi } from '../support/imports'

const SERVER_FN = { 'x-tsr-serverfn': 'true' }

test.describe('Importing a book', () => {
  test('EPUB: refusals, review (details, rename, merge, drop), save, the book page, read, continue reading, delete', async ({
    page,
    bookPage,
    importPage,
    libraryPage,
    readerPage,
  }) => {
    await signedInAt(page, '/account/books')
    await expect(
      page.getByText('Import only books you have the right to read. Imported books are private to your account.'),
    ).toBeVisible()
    await expect(
      page.getByText('Deleted books are removed at once. Nightly backups keep a copy for up to 14 days.'),
    ).toBeVisible()
    await expect(page.getByText('No books yet.', { exact: false })).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)

    await importPage.picker.setInputFiles({
      name: 'broken.epub',
      mimeType: 'application/epub+zip',
      buffer: Buffer.from('not really an epub'),
    })
    await expect(importPage.alert).toContainText('This file couldn’t be read')
    await importPage.picker.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('plain text'),
    })
    await expect(importPage.alert).toHaveText('Choose an .epub, .pdf, .md or .zip file.')

    await importPage.pick(FIXTURE.epub)
    const review = importPage.review
    await expect(review.getByLabel('Title', { exact: true })).toHaveValue('Field Notes')
    await expect(review.getByLabel('Author')).toHaveValue('Ada Tester')
    await expect(review.getByLabel('Language')).toHaveValue('en')
    await expect
      .poll(() => importPage.chapterTitles())
      .toEqual(['Getting Started', 'Second Thoughts', 'A Short Interlude', 'Final Words'])
    await expect(review.getByRole('button', { name: 'Merge chapter 1 into the one before' })).toBeDisabled()

    await expect(review.getByText('Cover and details')).toBeVisible()
    await expect(review.getByText('From the book’s file')).toBeVisible()
    const coverPreview = review.locator('.cover img')
    await expect(coverPreview).toHaveAttribute('src', /^blob:/)
    await imageLoaded(coverPreview)
    await expect(review.getByLabel('Description')).toHaveValue(
      'Notes kept by a lighthouse keeper.\n\nFour short chapters.',
    )
    await expect(review.getByLabel('ISBN')).toHaveValue('9780141439518')
    await expect(review.getByLabel('Publisher')).toHaveValue('Tester Press')
    await expect(review.getByLabel('Year')).toHaveValue('2019')
    await expect(review.getByText('56 of 4,000')).toBeVisible()
    await review.getByLabel('ISBN').fill('123')
    await expect(review.getByText('Not a valid ISBN.')).toBeVisible()
    await review.getByLabel('ISBN').fill('978-0-14-143951-8')
    await review.getByLabel('Description').fill('An edited description.')
    await expectAccessible(page)
    await expectNoSideways(page)

    await review.getByLabel('Chapter 1 title').fill('Beginnings')
    await review.getByRole('button', { name: 'Merge chapter 3 into the one before' }).click()
    await expect.poll(() => importPage.chapterTitles()).toEqual(['Beginnings', 'Second Thoughts', 'Final Words'])
    await review.getByRole('button', { name: 'Drop chapter 3' }).click()
    await expect.poll(() => importPage.chapterTitles()).toEqual(['Beginnings', 'Second Thoughts'])

    await review.getByRole('button', { name: 'Preview chapter 2' }).click()
    const preview = page.getByRole('region', { name: /^Preview: chapter 2, page \d of 2$/ })
    await expect(preview.getByRole('heading', { name: /page 1 of 2/ })).toBeVisible()
    await expect(preview.getByText('Second thoughts arrive', { exact: false })).toBeVisible()
    await expect(preview.getByText('Safe link text <b>not bold</b>.')).toBeVisible()
    await expect(preview.locator('img, script, a')).toHaveCount(0)
    await preview.getByRole('button', { name: 'Next page' }).click()
    await expect(preview.getByRole('heading', { name: /page 2 of 2/ })).toBeVisible()
    await expect(preview.getByText('An interlude of rain', { exact: false })).toBeVisible()
    await expectAccessible(page)

    await importPage.saveButton.click()
    await expect(page).toHaveURL(/\/account\/books\/([0-9a-f-]{36})\?status=imported$/)
    const id = /\/account\/books\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string
    await expect(page.getByRole('main').getByText('Book imported. It’s on your shelf.')).toBeVisible()
    const cover = bookPage.cover.locator('img')
    await expect(cover).toHaveAttribute('src', new RegExp(`^/account/books/${id}/cover\\?v=[0-9a-f]{8}$`))
    await imageLoaded(cover)
    await expect(bookPage.heading('Field Notes')).toBeVisible()
    await expect(bookPage.about).toContainText('An edited description.')
    await expect(page.getByRole('definition').filter({ hasText: '9780141439518' })).toBeVisible()
    await expect(page.getByText('From the book’s file')).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    await expect(page.locator('meta[property^="og:"]')).toHaveCount(0)
    await expectAccessible(page)
    await expectNoSideways(page)

    await importPage.goto()
    await hydrated(page)
    const books = importPage.books
    await expect(books.getByRole('link', { name: 'Field Notes', exact: true })).toHaveAttribute(
      'href',
      /^\/account\/books\/[0-9a-f-]{36}$/,
    )
    await expect(books.getByText('Ada Tester · 2 chapters', { exact: false })).toBeVisible()
    await expectAccessible(page)

    await books.getByRole('link', { name: 'Read Field Notes' }).click()
    await expect(page).toHaveURL(/\/read\/u-[0-9a-f-]{36}\/beginnings$/)
    const readerUrl = new URL(page.url()).pathname
    await expect(page.getByRole('heading', { level: 1, name: 'Beginnings' })).toBeVisible()
    await expect(page.getByText('Chapter 1 · Page 1 of 1')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/\/second-thoughts$/)
    await expect(readerPage.content.getByText('Safe link text <b>not bold</b>.')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/\/second-thoughts\/2$/)
    await expect(page.getByText('Chapter 2 · Page 2 of 2')).toBeVisible()
    await expect(readerPage.content.getByText('An interlude of rain', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined()
    await expect(
      page.locator('#reader-content img, #reader-content script, #reader-content a[href^="javascript"]'),
    ).toHaveCount(0)
    await page.locator(`a[href="/account/books/${id}"]:visible`).first().click()
    await expect(page).toHaveURL(new RegExp(`/account/books/${id}$`))

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    await expect(page.locator('meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]')).toHaveCount(0)
    const response = await page.request.get(readerUrl)
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('private, no-store')
    expect((await page.request.get('/account/books')).headers()['cache-control']).toBe('private, no-store')

    await libraryPage.goto()
    const card = libraryPage.myShelf.getByRole('link', { name: /Field Notes/ })
    await expect(card).toHaveAttribute('href', `/account/books/${id}`)
    await imageLoaded(card.locator('img'))
    await expect(libraryPage.continueReading.getByRole('link', { name: /Field Notes/ })).toBeVisible()
    await expectNoSideways(page)

    await importPage.goto()
    await importPage.deleteButton('Field Notes').click()
    await expect(page.getByRole('main').getByText('Book deleted.')).toBeVisible()
    await expect(page.getByText('No books yet.', { exact: false })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await hydrated(page)
    expect((await page.goto(readerUrl))?.status()).toBe(404)
    await libraryPage.goto()
    await expect(libraryPage.myShelf).toHaveCount(0)
    await expect(libraryPage.continueReading).toHaveCount(0)
  })
})

test.describe('Limits', () => {
  const tryImport = async (importPage: ImportPage) => {
    await importPage.goto()
    await importPage.pick(FIXTURE.markdown)
    await importPage.saveButton.click()
    return importPage.alert
  }

  test('10 imports an hour', async ({ page, baseURL, importPage }) => {
    await createUser(page.request, { signedIn: true })
    for (let i = 0; i < 10; i++)
      await importViaApi(page.request, baseURL ?? '', {
        title: `Book ${i}`,
        chapters: [{ title: 'One', text: 'Text.' }],
      })
    await expect(await tryImport(importPage)).toHaveText('You’ve imported 10 books in the last hour. Try again later.')
  })
})

async function serverFnCall(page: Page, needle: string, action: () => Promise<void>): Promise<string> {
  const call = page.waitForRequest(
    (r) => r.url().includes('/_serverFn/') && decodeURIComponent(r.url()).includes(needle),
  )
  await action()
  return (await call).url()
}

test.describe('Isolation', () => {
  const SECRET = 'Only its owner may ever read this sentence'

  test('a private book is reachable by its owner only, and never enters a shared path', async ({
    page,
    request: anonymous,
    baseURL,
    readerPage,
  }) => {
    await createUser(page.request, { signedIn: true })
    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Owner Only Diary',
      chapters: [
        { title: 'Opening', text: `${SECRET}. The first chapter.` },
        { title: 'Closing', text: `${SECRET}, again. The second chapter.` },
      ],
    })

    expect((await page.goto(book.href))?.status()).toBe(200)
    await expect(readerPage.content).toContainText(SECRET)
    const readerCall = await serverFnCall(page, book.slug, () => page.keyboard.press('ArrowRight'))
    await expect(page).toHaveURL(/\/closing$/)
    expect(await (await page.request.get(readerCall, { headers: SERVER_FN })).text()).toContain(SECRET)

    const other = await playwrightRequest.newContext({ baseURL })
    try {
      await createUser(other, { signedIn: true })
      for (const [who, request] of [
        ['another user', other],
        ['signed out', anonymous],
      ] as [string, APIRequestContext][]) {
        const body = await (await request.get(readerCall, { headers: SERVER_FN })).text()
        expect(body, who).not.toContain(SECRET)
        expect(body, who).not.toContain('Opening')
        expect(body, who).toMatch(/notFound|isNotFound/)
      }
    } finally {
      await other.dispose()
    }

    for (const path of [`/library/my-shelf/${book.slug}`, `/covers/${book.slug}.svg`, `/og/book/${book.slug}.png`])
      expect((await page.request.get(path)).status(), path).toBe(404)
    await page.goto('/library/poetry-of-the-spirit')
    expect(await page.content(), 'nav and series page').not.toContain('Owner Only Diary')
    const index = page.waitForResponse((r) => r.url().includes('/_serverFn/') && r.request().method() === 'GET')
    await page.keyboard.press('Control+k')
    const palette = await (await index).text()
    expect(palette).toContain('The Prophet')
    expect(palette).not.toContain('Owner Only Diary')

    await page.goto(book.href)
    await expect(readerPage.content).toContainText(SECRET)
  })
})

test.describe('Without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the list and Delete work; importing says it needs JavaScript', async ({ page, baseURL, importPage }) => {
    await createUser(page.request, { signedIn: true })
    await importViaApi(page.request, baseURL ?? '', {
      title: 'Plain Book',
      chapters: [{ title: 'One', text: 'Text.' }],
    })

    await importPage.goto()
    await expect(page.getByText('Importing needs JavaScript.')).toBeVisible()
    await expect(importPage.picker).toHaveCount(0)
    await importPage.deleteButton('Plain Book').click()
    await expect(page.getByRole('main').getByText('Book deleted.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Plain Book', exact: true })).toHaveCount(0)
  })
})
