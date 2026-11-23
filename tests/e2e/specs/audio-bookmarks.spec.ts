import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import type { BookContent } from '../../../src/shared/content/schema.ts'
import { utterances } from '../../../src/shared/read-aloud/sentences.ts'
import { speechChapter } from '../../../src/shared/read-aloud/speech-text.ts'
import { press, type ReadAloud, type ReaderPage } from '../pages'
import { signedInAt } from '../support/accounts'
import { fakeSpeech, hang, lastSpoken } from '../support/fake-speech'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'

const PAGE = '/read/pride-and-prejudice/chapter-6/2'
const pride = JSON.parse(readFileSync('tests/e2e/content/books/pride-and-prejudice.json', 'utf8')) as BookContent
const page2 = speechChapter(pride, 5)?.pages[1]
if (!page2) throw new Error('fixture page missing')
const sentences = utterances(page2, 'en')

const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true })
const listSection = (sheet: Locator) => sheet.getByRole('region', { name: 'Bookmarks in this book' })
const created = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith('/account/bookmarks/audio/new') && r.request().method() === 'POST')

async function startAt(readAloud: ReadAloud, href: string) {
  if (new URL(readAloud.page.url()).pathname !== href) await readAloud.page.goto(href)
  await hang(readAloud.page)
  await readAloud.start()
}

const openBookmarksTab = (readerPage: ReaderPage) => readerPage.contents.openTab('Bookmarks')

const seconds = (clock: string) => {
  const [mm = '0', ss = '0'] = clock.split(':')
  return Number(mm) * 60 + Number(ss)
}

test.describe('Audio bookmarks while reading aloud', () => {
  test.beforeEach(async ({ page }) => fakeSpeech(page))

  test('bookmark the sentence from the dock, play it from the sheet and the tab, jump chapters, remove it', async ({
    page,
    readAloud,
    readerPage,
  }) => {
    await signedInAt(page, PAGE)
    await startAt(readAloud, PAGE)
    const third = sentences[2]
    if (!third) throw new Error('the page has fewer than three sentences')
    await expect.poll(() => lastSpoken(page)).toBe(sentences[0]?.say)
    await press(page, readAloud.dockButton('Next sentence'))
    await press(page, readAloud.dockButton('Next sentence'))
    await expect.poll(() => lastSpoken(page)).toBe(third.say)

    const saved = created(page)
    await press(page, readAloud.dockButton('Bookmark this moment'))
    const response = await saved
    expect(response.status()).toBe(201)
    expect(response.request().postDataJSON()).toEqual({
      book: 'pride-and-prejudice',
      kind: 'voice',
      position: { chapter: 'chapter-6', page: 2 },
      offset: third.start,
    })
    await expect(page.getByText('Moment bookmarked · Ch. 6 · p. 2', { exact: true })).toBeVisible()
    await expect(readAloud.dockButton('Bookmark this moment')).toBeFocused()
    await expectNoSideways(page)

    await readAloud.openSheet()
    await expect(listSection(readAloud.sheet).getByRole('listitem')).toHaveCount(1)
    const entry = listSection(readAloud.sheet).getByRole('button', { name: /^Ch\. 6 · p\. 2/ })
    await expect(entry).toContainText(third.say.slice(0, 24))
    await expectAccessible(page)
    await expectNoSideways(page)

    await press(page, readAloud.sheetButton('Chapters'))
    const menu = page.getByRole('menu', { name: 'Chapters' })
    await expect(menu.getByRole('menuitemradio', { name: '6. Chapter 6' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu).toHaveCSS('opacity', '1')
    await expectAccessible(page)
    await press(page, menu.getByRole('menuitemradio', { name: '8. Chapter 8' }))
    await expect.poll(() => lastSpoken(page)).toMatch(/^Chapter 8\b/)
    await expect(readAloud.sheet.getByText('Chapter 8', { exact: true }).first()).toBeVisible()

    await press(page, entry)
    await expect.poll(() => lastSpoken(page)).toBe(third.say)

    await press(page, readAloud.sheetButton('Close'))
    await expect(readAloud.dock).toHaveCount(0)

    const tab = await openBookmarksTab(readerPage)
    const card = tab.getByRole('listitem').filter({ hasText: 'Listening' })
    await expect(card).toContainText('Ch. 6 · p. 2')
    await expect(card).toContainText(third.say.slice(0, 24))
    await press(page, card.getByRole('button', { name: 'Play from here, Ch. 6 · p. 2' }))
    await expect(readAloud.dock).toBeVisible()
    await expect.poll(() => lastSpoken(page)).toBe(third.say)

    if (!(await card.isVisible())) await openBookmarksTab(readerPage)
    const removed = page.waitForResponse((r) => /\/account\/bookmarks\/audio\/[0-9a-f-]{36}$/.test(r.url()))
    await press(page, card.getByRole('button', { name: 'Remove bookmark, Ch. 6 · p. 2' }))
    expect((await removed).status()).toBe(200)
    await expect(tab.getByText(/^No bookmarks yet\./)).toBeVisible()
  })

  test('signed out: the dock’s button opens the sheet at Sign in, and nothing is sent', async ({ page, readAloud }) => {
    const sent: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/account/bookmarks/audio/')) sent.push(r.url())
    })
    await startAt(readAloud, PAGE)
    await press(page, readAloud.dockButton('Bookmark this moment'))
    await expect(readAloud.sheet).toBeVisible()
    const section = listSection(readAloud.sheet)
    await expect(section.getByText('Sign in to bookmark moments.')).toBeInViewport()
    await expect(section.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(PAGE)}`,
    )
    await press(page, readAloud.sheetButton('Bookmark this moment'))
    expect(sent).toEqual([])
  })

  test('keyboard only: the dock’s button, then Chapters with the arrow keys', async ({ page, readAloud }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard reading on a desktop browser.')
    await signedInAt(page, PAGE)
    await startAt(readAloud, PAGE)
    const target = readAloud.dockButton('Bookmark this moment')
    await readAloud.dockButton('Next sentence').focus()
    await page.keyboard.press('Tab')
    await expect(target).toBeFocused()
    const saved = created(page)
    await page.keyboard.press('Enter')
    expect((await saved).status()).toBe(201)

    await readAloud.openSheet()
    const chapters = readAloud.sheetButton('Chapters')
    await chapters.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu', { name: 'Chapters' })
    await expect(menu).toBeVisible()
    await expect(async () => {
      await page.keyboard.press('ArrowDown')
      await expect(menu.getByRole('menuitemradio', { name: '7. Chapter 7' })).toBeFocused({ timeout: 200 })
    }).toPass()
    await page.keyboard.press('Enter')
    await expect.poll(() => lastSpoken(page)).toMatch(/^Chapter 7\b/)
  })
})

test.describe('Audio bookmarks while an audiobook plays', () => {
  test('bookmark the second, jump to an episode, and play the bookmark from its second', async ({
    page,
    audioPlayer,
  }) => {
    await signedInAt(page, '/library/poetry-of-the-spirit/the-prophet')
    await press(page, button(page, 'Listen'))
    const dock = audioPlayer.dock
    await expect(dock).toBeVisible()
    await expect(dock).toContainText('The Coming of the Ship')
    await press(page, audioPlayer.dockButton('Forward 15 seconds'))
    const clock = dock.getByText(/\d+:\d\d \/ /)
    await expect
      .poll(async () => seconds((await clock.textContent())?.split(' / ')[0] ?? ''))
      .toBeGreaterThanOrEqual(14)

    const saved = created(page)
    await press(page, audioPlayer.dockButton('Bookmark this moment'))
    const response = await saved
    expect(response.status()).toBe(201)
    const sent = response.request().postDataJSON() as { positionMs: number; episode: string }
    expect(sent).toMatchObject({ book: 'the-prophet', kind: 'episode', episode: 'ep_1' })
    expect(sent.positionMs % 1000).toBe(0)
    const at = Math.round(sent.positionMs / 1000)
    const mmss = `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`
    await expect(page.getByText(`Moment bookmarked · ${mmss}`, { exact: true })).toBeVisible()
    expect(Math.abs(seconds((await clock.textContent())?.split(' / ')[0] ?? '') - at)).toBeLessThanOrEqual(1)

    await audioPlayer.openSheet()
    await press(page, audioPlayer.sheetButton('Chapters'))
    await press(page, page.getByRole('menuitemradio', { name: /^2\. On Love · \d+ min$/ }))
    await expect(audioPlayer.sheetButton('On Love')).toBeVisible()

    const entry = listSection(audioPlayer.sheet).getByRole('button', { name: new RegExp(`^Chapter 1 · ${mmss}`) })
    await expect(entry).toContainText('The Coming of the Ship')
    await press(page, entry)
    await expect(audioPlayer.sheetButton('The Coming of the Ship')).toBeVisible()
    const slider = audioPlayer.sheet.getByRole('slider', { name: 'Progress' })
    await expect
      .poll(async () => seconds((await slider.getAttribute('aria-valuetext'))?.split(' of ')[0] ?? ''))
      .toBeGreaterThanOrEqual(at)
    expect(seconds((await slider.getAttribute('aria-valuetext'))?.split(' of ')[0] ?? '')).toBeLessThanOrEqual(at + 2)
  })
})
