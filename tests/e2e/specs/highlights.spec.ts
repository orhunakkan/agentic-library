import { readFileSync } from 'node:fs'
import type { APIRequestContext, Page } from '@playwright/test'
import type { HighlightView } from '../../../src/shared/highlights/group.ts'
import { escapeInline } from '../../../src/shared/highlights/markdown.ts'
import { type BookPage, bookPages } from '../../../src/shared/highlights/page-text.ts'
import { isWide, press, type ReaderPage } from '../pages'
import { createUser, saveKey, signedInAt } from '../support/accounts'
import { downloadText } from '../support/downloads'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { importViaApi, postJson } from '../support/imports'

const PAGE = '/read/pride-and-prejudice/chapter-6/2'
const pride = bookPages(JSON.parse(readFileSync('tests/e2e/content/books/pride-and-prejudice.json', 'utf8')))
const codeBook = bookPages(JSON.parse(readFileSync('tests/e2e/content/books/fixture-code-book.json', 'utf8')))

const painted = (page: Page, name: string) =>
  page.evaluate((n) => (CSS.highlights.get(n) as Highlight | undefined)?.size ?? 0, name)

async function highlightSelection(
  readerPage: ReaderPage,
  name: 'Highlight' | 'Note' = 'Highlight',
): Promise<HighlightView> {
  const saved = readerPage.page.waitForResponse((r) => r.url().endsWith('/account/highlights/new'))
  await press(readerPage.page, readerPage.button(name))
  const response = await saved
  expect(response.status(), await response.text()).toBe(201)
  return ((await response.json()) as { highlight: HighlightView }).highlight
}

function textOf(chapter: string, n: number): BookPage {
  const found = pride.find((p) => p.chapterSlug === chapter && p.page === n)
  if (!found) throw new Error(`no page ${chapter}/${n}`)
  return found
}

async function highlightViaApi(
  request: APIRequestContext,
  baseURL: string,
  at: { chapter: string; page: number },
  span: [number, number] = [0, 40],
  note: string | null = null,
): Promise<HighlightView> {
  const response = await postJson(request, baseURL, '/account/highlights/new', {
    book: 'pride-and-prejudice',
    position: at,
    start: span[0],
    end: span[1],
    text: textOf(at.chapter, at.page).text.slice(...span),
    color: 'yellow',
    note,
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { highlight: HighlightView }).highlight
}

test.describe('Highlights in the reader', () => {
  test('signed out: Highlight opens the tab with why, and Sign in links back to the page', async ({
    page,
    readerPage,
  }) => {
    await page.goto(PAGE)
    await readerPage.select(readerPage.paragraph())
    await press(page, readerPage.button('Highlight'))
    const tab = readerPage.contents.tabPanel('Highlights')
    await expect(tab.getByText('Sign in to highlight passages and keep notes on this book.')).toBeVisible()
    const signInLink = tab.getByRole('link', { name: 'Sign in' })
    await expect(signInLink).toHaveAttribute('href', `/login?next=${encodeURIComponent(PAGE)}`)
    await expectAccessible(page)
  })

  test('Highlight paints the passage at once, Note opens the tab with its box focused, and both survive a reload', async ({
    page,
    readerPage,
  }) => {
    await signedInAt(page, PAGE)
    await readerPage.select(readerPage.paragraph())
    await expect(readerPage.button('Note')).toBeVisible()
    if (!isWide(page)) await expectNoSideways(page)
    await highlightSelection(readerPage)
    await expect(page.getByText('Highlighted', { exact: true })).toBeVisible()
    expect(await painted(page, 'hl-yellow')).toBe(1)

    await readerPage.select(readerPage.paragraph(1))
    await highlightSelection(readerPage, 'Note')
    const box = page.getByRole('textbox', { name: 'Note' })
    await expect(box).toBeFocused()
    await box.fill('Remember this.\nOn two lines.')
    await box.press('Control+Enter')
    await expect(page.getByText('Note saved')).toBeVisible()
    await expect.poll(() => painted(page, 'hl-note')).toBe(1)

    await page.reload()
    await expect.poll(() => painted(page, 'hl-yellow')).toBe(2)
    await expect.poll(() => painted(page, 'hl-note')).toBe(1)
    const tab = await readerPage.contents.openTab('Highlights')
    await expect(tab.getByRole('heading', { name: 'On this page' })).toBeVisible()
    await expect(tab.getByText(textOf('chapter-6', 2).text.slice(0, 30))).toBeVisible()
    await expect(tab.getByText(/Remember this\.\s*On two lines\./)).toBeVisible()
    await expect(readerPage.contents.tab('Highlights')).toHaveText(/Highlights\s*2/)
    await expectAccessible(page)
    if (!isWide(page)) await expectNoSideways(page)
  })

  test('the popover recolours, asks about, explains and deletes a highlight, with a second step for a note', async ({
    page,
    readerPage,
  }) => {
    await createUser(page.request, { signedIn: true })
    await saveKey(page)
    await page.goto(PAGE)
    await readerPage.select(readerPage.paragraph())
    const h = await highlightSelection(readerPage)

    let popover = await readerPage.openHighlightPopover()
    await expectAccessible(page)
    if (!isWide(page)) await expectNoSideways(page)
    const saved = page.waitForResponse((r) => /\/account\/highlights\/[0-9a-f-]{36}$/.test(r.url()))
    await press(page, popover.locator('label', { hasText: 'Green' }))
    expect((await saved).status()).toBe(200)
    await expect.poll(() => painted(page, 'hl-green')).toBe(1)
    expect(await painted(page, 'hl-yellow')).toBe(0)
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()

    popover = await readerPage.openHighlightPopover()
    await press(page, popover.getByRole('button', { name: 'Ask about this' }))
    const ask = page
      .getByRole('complementary', { name: 'Ask this book' })
      .or(page.getByRole('dialog', { name: 'Ask this book' }))
    await expect(ask.getByText('Asking about')).toBeVisible()
    const closeAsk = async () => {
      if (!isWide(page)) await page.keyboard.press('Escape')
      else await press(page, ask.getByRole('button', { name: 'Close Ask this book' }))
      await expect(ask).toBeHidden()
    }
    await closeAsk()

    popover = await readerPage.openHighlightPopover()
    await press(page, popover.getByRole('button', { name: 'Explain', exact: true }))
    await expect(popover).toBeHidden()
    const question = ask.getByText('Explain this passage in plain words.')
    await expect(question).toBeVisible()
    await expect(question).toContainText(h.text.replace(/\s+/g, ' '))
    await expect(ask.getByText(/the passage you selected\. Request: explain\./)).toBeVisible()
    await closeAsk()

    popover = await readerPage.openHighlightPopover()
    await press(page, popover.getByRole('button', { name: 'Add note' }))
    const note = page.getByRole('textbox', { name: 'Note' })
    await expect(note).toBeFocused()
    await note.fill('Keep this.')
    await press(page, page.getByRole('button', { name: 'Save' }))
    await expect.poll(() => painted(page, 'hl-note')).toBe(1)
    if (!isWide(page)) {
      await page.keyboard.press('Escape')
      await expect(readerPage.contents.drawer).toBeHidden()
    }

    popover = await readerPage.openHighlightPopover()
    await press(page, popover.getByRole('button', { name: 'Delete' }))
    await expect(popover.getByRole('button', { name: 'Delete highlight and note?' })).toBeVisible()
    expect(await painted(page, 'hl-green')).toBe(1)
    await press(page, popover.getByRole('button', { name: 'Delete highlight and note?' }))
    await expect(page.getByText('Highlight deleted')).toBeVisible()
    await expect.poll(() => painted(page, 'hl-green')).toBe(0)
  })

  test('the list exports the book as Markdown, and a page chip opens its page and marks the highlight there', async ({
    page,
    baseURL,
    readerPage,
  }) => {
    await createUser(page.request, { signedIn: true })
    const h = await highlightViaApi(page.request, baseURL ?? '', { chapter: 'chapter-6', page: 2 }, [0, 40], 'A note.')
    const elsewhere = await highlightViaApi(page.request, baseURL ?? '', { chapter: 'chapter-6', page: 3 })
    await page.goto(PAGE)
    const tab = await readerPage.contents.openTab('Highlights')
    const download = page.waitForEvent('download')
    await press(page, tab.getByRole('link', { name: 'Export as Markdown' }))
    const file = await download
    expect(file.suggestedFilename()).toBe('pride-and-prejudice-highlights.md')
    const text = await downloadText(file)
    expect(text).toMatch(/^---\ntitle: "Pride and Prejudice"\nauthor: "Jane Austen"\n/)
    expect(text).toMatch(
      /\n---\n\n# Pride and Prejudice\n\nJane Austen · 2 highlights · exported from Folio on \d{4}-\d\d-\d\d\n/,
    )
    expect(text).toContain(`## 6. Chapter 6\n\n> ${escapeInline(h.text)}\n\nA note.\n\n[Ch. 6 · p. 2](`)
    expect(text).toContain(`/read/pride-and-prejudice/chapter-6/2#highlight-${h.id})`)

    await press(page, tab.getByRole('link', { name: 'Ch. 6 · p. 3' }))
    await expect(page).toHaveURL(`/read/pride-and-prejudice/chapter-6/3#highlight-${elsewhere.id}`)
    await expect.poll(() => painted(page, 'hl-flash'), { intervals: [50] }).toBe(1)
    await expect.poll(() => painted(page, 'hl-flash')).toBe(0)
    expect(await painted(page, 'hl-yellow')).toBe(1)
  })

  test('the whole page, selected and highlighted, is accepted on every kind of page', async ({
    page,
    baseURL,
    readerPage,
  }) => {
    await createUser(page.request, { signedIn: true })
    const imported = await importViaApi(page.request, baseURL ?? '', {
      title: 'Highlight Notebook',
      chapters: [{ title: 'Only Chapter', text: 'A <b>private</b> page & its “quotes”, with   spaces.' }],
    })
    const hrefs = [...codeBook, textOf('chapter-1', 1)].map((p) => p.href)
    hrefs.push('/read/confessions-of-al-ghazzali/8', '/read/confessions-of-al-ghazzali/31', imported.href)
    for (const href of hrefs) {
      await page.goto(href)
      await readerPage.select(page.locator('#reader-content [data-highlight-root]'))
      const saved = await highlightSelection(readerPage)
      expect(saved.status, href).toBe('ok')
    }
  })

  test('keyboard only: the toolbar, the tab, the note editor and Delete', async ({ page, readerPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard reading on desktop; the phone is touch.')
    await signedInAt(page, PAGE)
    await page.getByRole('link', { name: 'Skip to content' }).focus()
    await page.keyboard.press('Enter')
    await expect(readerPage.content).toBeFocused()
    await readerPage.paragraph().evaluate((p) => {
      const range = document.createRange()
      range.setStart(p.firstChild ?? p, 0)
      range.setEnd(p.firstChild ?? p, 40)
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
    })
    await expect(readerPage.button('Highlight')).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Bookmark this page' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(readerPage.button('Highlight')).toBeFocused()
    const saved = page.waitForResponse((r) => r.url().endsWith('/account/highlights/new'))
    await page.keyboard.press('Enter')
    expect((await saved).status()).toBe(201)
    await expect(readerPage.content).toBeFocused()

    const contentsTab = page.getByRole('tab', { name: 'Contents' })
    for (let i = 0; i < 80 && !(await contentsTab.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Shift+Tab')
    await expect(contentsTab).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(readerPage.contents.tabPanel('Highlights')).toBeVisible()
    const addNote = readerPage.contents.tabPanel('Highlights').getByRole('button', { name: 'Add note' })
    for (let i = 0; i < 10 && !(await addNote.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab')
    await expect(addNote).toBeFocused()
    await page.keyboard.press('Enter')
    const note = readerPage.contents.tabPanel('Highlights').getByRole('textbox', { name: 'Note' })
    await expect(note).toBeFocused()
    await page.keyboard.type('Typed with keys.')
    await page.keyboard.press('Control+Enter')
    await expect(readerPage.contents.tabPanel('Highlights').getByText('Typed with keys.')).toBeVisible()
    const remove = readerPage.contents.tabPanel('Highlights').getByRole('button', { name: 'Delete' })
    for (let i = 0; i < 10 && !(await remove.evaluate((el) => el === document.activeElement)); i++)
      await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(
      readerPage.contents.tabPanel('Highlights').getByRole('button', { name: 'Delete highlight and note?' }),
    ).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(
      readerPage.contents.tabPanel('Highlights').getByText('Select text on the page to highlight it or add a note.'),
    ).toBeVisible()
    expect(await painted(page, 'hl-yellow')).toBe(0)
  })
})

test.describe('Highlights across books and accounts', () => {
  test('a private book: its owner highlights it, sees it listed, and deleting the book removes them', async ({
    page,
    baseURL,
    readerPage,
  }) => {
    await createUser(page.request, { signedIn: true })
    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Private Margins',
      chapters: [{ title: 'Only Chapter', text: 'A private passage that only its owner may mark.' }],
    })
    await page.goto(book.href)
    await readerPage.select(readerPage.paragraph())
    await highlightSelection(readerPage)
    await page.goto('/account/highlights')
    await expect(page.getByRole('link', { name: 'Private Margins' })).toBeVisible()
    await expectAccessible(page)
    await page.getByRole('link', { name: 'Private Margins' }).click()
    await expect(page.getByRole('heading', { name: '1. Only Chapter' })).toBeVisible()
    await expectAccessible(page)

    const deleted = await page.request.post('/account/books', {
      form: { intent: 'delete', id: book.id },
      headers: { origin: new URL(baseURL ?? '').origin },
      maxRedirects: 0,
    })
    expect(deleted.headers().location).toBe('/account/books?status=deleted')
    await page.goto('/account/highlights')
    await expect(page.getByText('No highlights yet. Select text while reading to highlight it.')).toBeVisible()
  })

  test('the page sends a signed-out visitor to sign in, and is a 404 for a book it doesn’t know', {
    tag: '@http',
  }, async ({ request }) => {
    const signedOut = await request.get('/account/highlights?book=pride-and-prejudice', { maxRedirects: 0 })
    expect(signedOut.status()).toBeGreaterThanOrEqual(300)
    expect(signedOut.status()).toBeLessThan(400)
    expect(signedOut.headers().location).toContain(
      `/login?next=${encodeURIComponent('/account/highlights?book=pride-and-prejudice')}`,
    )

    await createUser(request, { signedIn: true })
    expect((await request.get('/account/highlights?book=no-such-book')).status()).toBe(404)
  })

  test('Ask offers to explain the chapter’s highlights, and sends them', async ({ page, baseURL, readerPage }) => {
    await createUser(page.request, { signedIn: true })
    await saveKey(page)
    await highlightViaApi(page.request, baseURL ?? '', { chapter: 'chapter-6', page: 1 })
    await highlightViaApi(page.request, baseURL ?? '', { chapter: 'chapter-6', page: 2 }, [10, 60])
    await readerPage.goto('pride-and-prejudice', 'chapter-3', 2)
    await press(page, page.getByRole('button', { name: /^Ask( this book)?$/ }))
    const ask = page
      .getByRole('complementary', { name: 'Ask this book' })
      .or(page.getByRole('dialog', { name: 'Ask this book' }))
    await expect(ask.getByRole('button', { name: /Summarise this chapter so far/ })).toBeVisible()
    await expect(ask.getByRole('button', { name: /Explain my highlights/ })).toHaveCount(0)

    await page.goto(PAGE)
    if (!(await ask.isVisible())) await press(page, page.getByRole('button', { name: /^Ask( this book)?$/ }))
    const explain = ask.getByRole('button', { name: /Explain my highlights in this chapter/ })
    await expect(explain).toContainText('Sends your highlights and notes in this chapter with the question.')
    await press(page, explain)
    await expect(ask.getByText(/and 2 of your highlights/)).toBeVisible()
  })
})

test.describe('All highlights without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the summaries, one book’s list, Delete and Delete all', async ({ page, baseURL }) => {
    await createUser(page.request, { signedIn: true })
    await page.goto('/account/highlights')
    await expect(page.getByText('No highlights yet. Select text while reading to highlight it.')).toBeVisible()
    await highlightViaApi(page.request, baseURL ?? '', { chapter: 'chapter-6', page: 2 }, [0, 40], 'First note.')
    await highlightViaApi(page.request, baseURL ?? '', { chapter: 'chapter-6', page: 3 })

    await page.goto('/account/highlights')
    await expect(page.getByText(/2 highlights · 1 note · changed/)).toBeVisible()
    const exportAll = page.getByRole('link', { name: 'Export all as Markdown' })
    await expect(exportAll).toHaveAttribute('href', '/account/highlights/export')
    const download = page.waitForEvent('download')
    await exportAll.click()
    expect((await download).suggestedFilename()).toMatch(/^folio-highlights-\d{4}-\d\d-\d\d\.md$/)
    await page.getByRole('link', { name: 'Pride and Prejudice' }).click()
    await expect(page).toHaveURL(/\?book=pride-and-prejudice$/)
    await expect(page.getByRole('heading', { name: '6. Chapter 6' })).toBeVisible()
    await expect(page.getByText('First note.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ch. 6 · p. 2' })).toHaveAttribute(
      'href',
      /\/read\/pride-and-prejudice\/chapter-6\/2#highlight-/,
    )
    if (!isWide(page)) await expectNoSideways(page)

    await page.getByRole('button', { name: 'Delete this highlight' }).first().click()
    await expect(page.getByText('Highlight deleted.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete this highlight' })).toHaveCount(1)
    await page.getByText('Delete all highlights in this book').click()
    await page.getByRole('button', { name: 'Delete all highlights' }).click()
    await expect(page.getByText('Deleted every highlight in this book.')).toBeVisible()
    await expect(page.getByText('No highlights yet. Select text while reading to highlight it.')).toBeVisible()
  })
})
