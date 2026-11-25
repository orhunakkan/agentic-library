import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import type { ImportPage } from '../pages'
import { signedInAt } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'

const FIXTURES = join(import.meta.dirname, '../fixtures/imports')
const HANDBOOK = join(FIXTURES, 'pdf-handbook.pdf')
const SCANNED = join(FIXTURES, 'pdf-scanned.pdf')
const HANDBOOK_CHAPTERS = ['Keeping the Light', 'Signals and Codes', 'Keeping Records']

const readAs = (review: Locator, font: string) => review.getByLabel(`Read ${font} as`)

async function previewText(importPage: ImportPage, chapter: number): Promise<string> {
  await importPage.review.getByRole('button', { name: `Preview chapter ${chapter}`, exact: true }).click()
  const preview = importPage.page.getByRole('region', { name: new RegExp(`^Preview: chapter ${chapter}, page`) })
  const parts: string[] = []
  for (;;) {
    parts.push((await preview.locator('.prose-reader').innerHTML()) ?? '')
    const next = preview.getByRole('button', { name: 'Next page' })
    if (await next.isDisabled()) break
    const heading = await preview.getByRole('heading').first().textContent()
    await next.click()
    await expect(preview.getByRole('heading').first()).not.toHaveText(heading ?? '')
  }
  await preview.getByRole('button', { name: 'Close preview' }).click()
  return parts.join('\n')
}

test.describe('Importing a PDF', () => {
  test('a handbook’s review says how the PDF was read', async ({ page, importPage }) => {
    await signedInAt(page, '/account/books')
    await expect(
      page.getByText('Choose an EPUB, PDF, Markdown file or ZIP of Markdown files', { exact: false }),
    ).toBeVisible()
    await page.evaluate(() => {
      const seen: string[] = []
      ;(window as { __progress?: string[] }).__progress = seen
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('[role="status"]')) {
          const text = el.textContent?.trim() ?? ''
          if (text && !seen.includes(text)) seen.push(text)
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await importPage.pick(HANDBOOK)
    const progress = await page.evaluate(() => (window as { __progress?: string[] }).__progress ?? [])
    expect(progress).toContain('Reading page 9 of 9…')

    const review = importPage.review
    await expect(review.getByLabel('Title', { exact: true })).toHaveValue('The Lantern Handbook')
    await expect.poll(() => importPage.chapterTitles()).toEqual(HANDBOOK_CHAPTERS)
    const reading = review.getByTestId('pdf-reading')
    await expect(reading.getByRole('heading', { name: 'How the PDF was read' })).toBeVisible()
    await expect(reading.getByTestId('pdf-summary')).toHaveText(
      '9 pages · chapters from the PDF’s bookmarks · page numbers and running headers left out on 9 pages · 3 pictures cropped from the pages.',
    )
    await expect(reading.getByRole('radio', { name: 'The PDF’s bookmarks' })).toBeChecked()
    await expect(readAs(reading, 'Geist-Bold, 20pt')).toHaveValue('chapter')
    await expect(readAs(reading, 'Geist-Bold, 13pt')).toHaveValue('h3')
    await expect(readAs(reading, 'JetBrainsMono-Regular, 8.5pt')).toHaveValue('code')
    await expect(readAs(reading, 'Source-Serif-4-14pt, 10pt')).toHaveValue('body')
    await expect(reading.getByTestId('pdf-style').first()).toContainText('Source-Serif-4-14pt, 10pt')
    await expect(review.getByTestId('picture-summary')).toHaveText('3 pictures')
    await expectAccessible(page)
    await expectNoSideways(page)
  })

  test('reading a handbook again asks first, because it undoes chapter changes', async ({ page, importPage }) => {
    await signedInAt(page, '/account/books')
    await importPage.pick(HANDBOOK)
    const review = importPage.review
    await expect.poll(() => importPage.chapterTitles()).toEqual(HANDBOOK_CHAPTERS)

    await review.getByLabel('Chapter 1 title').fill('My own title')
    await readAs(review, 'Geist-Bold, 20pt').selectOption('Body text')
    const confirm = page.getByRole('dialog', { name: 'Reading the PDF again undoes your chapter changes.' })
    await test.step('Cancel keeps the chapters as edited', async () => {
      await expect(confirm).toBeVisible()
      await confirm.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirm).toBeHidden()
      await expect(readAs(review, 'Geist-Bold, 20pt')).toHaveValue('chapter')
      await expect.poll(() => importPage.chapterTitles()).toEqual(['My own title', ...HANDBOOK_CHAPTERS.slice(1)])
    })
    await test.step('Read again applies the correction', async () => {
      await readAs(review, 'Geist-Bold, 20pt').selectOption('Body text')
      await confirm.getByRole('button', { name: 'Read again' }).click()
      await expect(readAs(review, 'Geist-Bold, 20pt')).toHaveValue('body')
      await expect.poll(() => importPage.chapterTitles()).toEqual(HANDBOOK_CHAPTERS)
    })
    await test.step('with nothing left to undo, it doesn’t ask', async () => {
      await readAs(review, 'Geist-Bold, 20pt').selectOption('Chapter title')
      await expect(readAs(review, 'Geist-Bold, 20pt')).toHaveValue('chapter')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })
  })

  test('a handbook’s preview keeps its code, pictures and emphasis', async ({ page, importPage }) => {
    await signedInAt(page, '/account/books')
    await importPage.pick(HANDBOOK)
    await expect.poll(() => importPage.chapterTitles()).toEqual(HANDBOOK_CHAPTERS)
    const first = await previewText(importPage, 1)
    expect(first).toContain('<pre>')
    expect(first).toContain('function trim(wick) {')
    expect(first).toMatch(/<figure>.*<img[^>]+src="blob:/s)
    expect(first).toContain('Figure 1.1 The lamp room at dusk.')
    expect(first).toContain('<em>patience</em>')
    expect(first).toContain('transformation')
  })

  test('a saved handbook reads in the reader as it was laid out', async ({ page, importPage, readerPage }) => {
    await signedInAt(page, '/account/books')
    await importPage.pick(HANDBOOK)
    const review = importPage.review
    await expect.poll(() => importPage.chapterTitles()).toEqual(HANDBOOK_CHAPTERS)

    await test.step('saving keeps its pictures', async () => {
      await expect(review.getByLabel('Author')).toHaveValue('')
      await review.getByLabel('Author').fill('Ada Tester')
      await importPage.saveButton.click()
      await expect(page).toHaveURL(/\/account\/books\/[0-9a-f-]{36}\?status=imported$/)
      await expect(page.locator('dl').locator('div', { hasText: 'Pictures' }).locator('dd')).toHaveText('3')
    })

    await page.getByRole('main').getByRole('link', { name: 'Start reading' }).click()
    await expect(page).toHaveURL(/\/read\/u-[0-9a-f-]{36}\/keeping-the-light$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Keeping the Light' })).toBeVisible()
    await expectAccessible(page)
    const chapterUrl = page.url()
    const content = readerPage.content
    const figurePage = await test.step('the first chapter keeps its headings, lists, code and notes', async () => {
      const count = page.getByText(/Chapter 1 · Page 1 of \d+/)
      const total = Number((await count.textContent())?.match(/Page 1 of (\d+)/)?.[1])
      let html = ''
      let withFigure = 0
      for (let n = 1; n <= total; n++) {
        if (n > 1) await page.goto(`${chapterUrl}/${n}`)
        await expect(page.getByText(`Chapter 1 · Page ${n} of ${total}`)).toBeVisible()
        html += await content.innerHTML()
        if (!withFigure && (await content.locator('figure').count())) withFigure = n
      }
      expect(html).toMatch(/<h3[^>]*>Trimming the Wick<\/h3>/)
      expect(html).toMatch(/<ul>\s*<li>a clean glass/)
      expect(html).toMatch(/<pre>function trim\(wick\) \{\n {2}if \(wick\.length &gt; 4\) \{/)
      expect(html).toMatch(/<h4[^>]*>Notes<\/h4>\s*<p><sup>1<\/sup> The diary is kept in the harbour office\.<\/p>/)
      expect(html).not.toMatch(/<p>[^<]*Keeping the Light/)
      expect(html).not.toMatch(/<p>\s*\d+\s*<\/p>/)
      return withFigure
    })

    await test.step('its figure opens in the picture viewer', async () => {
      expect(figurePage).toBeGreaterThan(0)
      await page.goto(figurePage > 1 ? `${chapterUrl}/${figurePage}` : chapterUrl)
      await content.locator('figure a').scrollIntoViewIfNeeded()
      await content.locator('figure a').click()
      const dialog = page.getByRole('dialog', { name: 'Figure 1.1 The lamp room at dusk.' })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('img')).toHaveAttribute('alt', 'Figure from page 2')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    })
  })

  test('scanned and broken PDFs are refused, and reading can be cancelled', async ({ page, importPage }) => {
    await signedInAt(page, '/account/books')
    const picker = importPage.picker
    const alert = importPage.alert

    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/assets/pdf*', async (route) => {
      await held
      await route.continue()
    })
    await picker.setInputFiles(HANDBOOK)
    const cancel = page.getByRole('button', { name: 'Cancel' })
    await expect(cancel).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Reading the PDF' })).toBeVisible()
    await cancel.click()
    release()
    await expect(importPage.picker).toBeAttached()
    await expect(alert).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Review before saving' })).toHaveCount(0)

    await picker.setInputFiles(SCANNED)
    await expect(alert).toHaveText('This PDF is scanned pages with no text in it. Folio can’t read those yet.')

    await picker.setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
    await expect(alert).toContainText('This file couldn’t be read')
  })
})
