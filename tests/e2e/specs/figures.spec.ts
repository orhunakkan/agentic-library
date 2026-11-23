import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, hydrated, test } from '../support/fixtures'

const FIXTURES = join(import.meta.dirname, '../fixtures/imports')
const FIGURES = join(FIXTURES, 'figures.epub')

const loaded = (page: Page, selector: string) =>
  page
    .locator(selector)
    .evaluateAll((images) => images.length > 0 && images.every((i) => (i as HTMLImageElement).naturalWidth > 0))

const FIGURE_CHAPTER = '/read/fixture-figure-book/drawing-the-flow'

test.describe('Importing a book with pictures', () => {
  test('the review counts the pictures and says why some are left out; the book opens with them', async ({
    page,
    importPage,
    readerPage,
  }) => {
    await signedInAt(page, '/account/books')
    await importPage.pick(FIGURES)
    const review = page.getByRole('form', { name: 'Review before saving' })
    const summary = review.getByTestId('picture-summary')
    await expect(summary.getByText('3 pictures · 2 left out')).toBeVisible()
    await summary.getByText('Why?').click()
    await expect(summary.getByRole('listitem')).toHaveText([
      '1 from the web (Folio doesn’t fetch them)',
      '1 couldn’t be read',
    ])
    await expect(review.getByRole('button', { name: 'Save to my shelf' })).toBeEnabled()

    await review.getByRole('button', { name: 'Preview chapter 1' }).click()
    const preview = page.getByRole('region', { name: /^Preview: chapter 1/ })
    await expect(preview.locator('figure img')).toHaveAttribute('src', /^blob:/)
    await expect(preview.getByText('The harbour at low tide')).toBeVisible()
    await preview.locator('figure img').scrollIntoViewIfNeeded()
    await expect.poll(() => loaded(page, '[aria-labelledby="preview-title"] figure img')).toBe(true)
    await expectAccessible(page)
    await expectNoSideways(page)

    await page.route('**/account/books/*/images/*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250))
      await route.continue()
    })
    await review.getByRole('button', { name: 'Save to my shelf' }).click()
    await expect(page.getByRole('status').getByText(/^Uploading pictures… \d of 3$/)).toBeVisible()
    await expect(page).toHaveURL(/\/account\/books\/[0-9a-f-]{36}\?status=imported$/)
    const facts = page.locator('dl')
    await expect(facts.locator('div', { hasText: 'Pictures' }).locator('dd')).toHaveText('3')

    await page
      .getByRole('link', { name: /Start reading/ })
      .first()
      .click()
    await expect(page).toHaveURL(/\/read\/u-[0-9a-f-]{36}\/charts-and-maps$/)
    await hydrated(page)
    const figure = readerPage.content.locator('figure').first()
    await expect(figure.locator('img')).toHaveAttribute('src', /^\/account\/books\/[0-9a-f-]{36}\/images\/1$/)
    await expect(figure.getByText('The harbour at low tide')).toBeVisible()
    await readerPage.content.locator('figure img').first().scrollIntoViewIfNeeded()
    await expect.poll(() => loaded(page, '#reader-content figure img')).toBe(true)
    await expectNoSideways(page)
    await expectAccessible(page)
  })
})

test.describe('The full-screen view', () => {
  test('opens from the picture, keeps the page still, and closes by Esc, Close and the backdrop', async ({
    page,
    isMobile,
    readerPage,
  }) => {
    await page.goto(FIGURE_CHAPTER)
    const link = readerPage.content.locator('figure a')
    const dialog = page.getByRole('dialog', { name: 'The flow of a small program' })

    if (isMobile) await link.tap()
    else await link.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('img')).toHaveAttribute('alt', 'Boxes joined by arrows, left to right')
    await expect(dialog.getByText('The flow of a small program')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${FIGURE_CHAPTER}$`))
    await expectAccessible(page)
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(new RegExp(`${FIGURE_CHAPTER}$`))
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(link).toBeFocused()

    await link.focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close picture' }).click()
    await expect(dialog).toBeHidden()
    await expect(link).toBeFocused()

    await link.click()
    await expect(dialog).toBeVisible()
    await page.mouse.click(4, (page.viewportSize()?.height ?? 600) - 4)
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`${FIGURE_CHAPTER}$`))
  })
})

test.describe('Where pictures are served', () => {
  test('a catalogue picture is immutable at its hashed address', { tag: '@http' }, async ({ request }) => {
    const book = JSON.parse(
      readFileSync(join(import.meta.dirname, '../content/books/fixture-figure-book.json'), 'utf8'),
    ) as { chapters: { pages: string[] }[] }
    const src = /<img src="([^"]+)"/.exec(book.chapters[0]?.pages.join('') ?? '')?.[1] ?? ''
    expect(src).toMatch(/^\/images\/fixture-figure-book\/[0-9a-f]{12}\.png$/)
    const response = await request.get(src)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('image/png')
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
    expect((await request.get(src.replace(/[0-9a-f]{12}/, '000000000000'))).status()).toBe(404)
    expect((await request.get('/images/pride-and-prejudice/000000000000.png')).status()).toBe(404)
  })

  test('the catalogue book shows its figure, on a white card in dark and straight on the page in light', async ({
    page,
    readerPage,
  }) => {
    await readerPage.goto('fixture-figure-book', 'drawing-the-flow')
    await hydrated(page)
    const figure = readerPage.content.locator('figure')
    await expect(figure.locator('img')).toHaveAttribute('alt', 'Boxes joined by arrows, left to right')
    await expect(figure.locator('figcaption')).toHaveText('The flow of a small program')
    await readerPage.content.locator('figure img').first().scrollIntoViewIfNeeded()
    await expect.poll(() => loaded(page, '#reader-content figure img')).toBe(true)
    await expectNoSideways(page)

    const background = () => readerPage.content.locator('figure a').evaluate((a) => getComputedStyle(a).backgroundColor)
    await page.getByRole('button', { name: 'Settings' }).first().click()
    const panel = readerPage.settings
    await panel.getByText('Dark').click()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'dark')
    await expect.poll(background).toBe('rgb(255, 255, 255)')
    await panel.getByText('Light').click()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'light')
    await expect.poll(background).toBe('rgba(0, 0, 0, 0)')
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Settings' }).first().click()
    await panel.getByText('Dark').click()
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden' })
    await expectAccessible(page)
  })
})
