import { readFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import type { BookContent } from '../../../src/shared/content/schema.ts'
import { utterances } from '../../../src/shared/read-aloud/sentences.ts'
import { speechChapter } from '../../../src/shared/read-aloud/speech-text.ts'
import { isWide, press, type ReadAloud } from '../pages'
import { createUser } from '../support/accounts'
import { DEVICE_VOICE, fakeSpeech, hang, lastSpoken, marked, spoken } from '../support/fake-speech'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { importViaApi } from '../support/imports'

const prophet = JSON.parse(readFileSync('tests/e2e/content/books/the-prophet.json', 'utf8')) as BookContent

function said(chapter: number, page = 0): string[] {
  const found = speechChapter(prophet, chapter)?.pages[page]
  if (!found) throw new Error(`no page ${chapter}/${page}`)
  return utterances(found, 'en').map((u) => u.say)
}
const ON_LOVE = '/read/the-prophet/on-love'
const love = said(1)

const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true })
const lastVoice = (page: Page) => page.evaluate(() => window.__speech.at(-1)?.voice)
const selectParagraph = (page: Page) =>
  page
    .locator('#reader-content [data-highlight-root] p')
    .nth(3)
    .evaluate((el) => {
      document.getSelection()?.selectAllChildren(el)
    })

async function runUntil(page: Page, done: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 400 && !(await done()); i++) await page.clock.runFor(500)
}

const onPath = (page: Page, path: string) => () => new URL(page.url()).pathname === path

async function startAt(readAloud: ReadAloud, href: string, options: { hang?: boolean } = {}) {
  await readAloud.page.goto(href)
  if (options.hang ?? true) await hang(readAloud.page)
  await readAloud.start()
}

test.describe('Read aloud in the reader', () => {
  test.beforeEach(async ({ page }) => fakeSpeech(page))

  test("says the chapter, then reads the page's first sentence and marks it; pause, play, previous, next and speed", async ({
    page,
    readAloud,
  }) => {
    await startAt(readAloud, ON_LOVE)
    await expect.poll(() => spoken(page)).toEqual(['Chapter 2. On Love.'])
    expect(await marked(page)).toBeNull()
    await expectNoSideways(page)
    await expect(button(page, 'Pause reading')).toBeVisible()
    await press(page, readAloud.dockButton('Next sentence'))
    await expect.poll(() => lastSpoken(page)).toBe(love[0])
    await expect.poll(() => marked(page)).toBe(love[0])
    await expectAccessible(page)

    await press(page, readAloud.dockButton('Pause'))
    await expect(readAloud.startButton).toBeVisible()
    await press(page, readAloud.dockButton('Play'))
    await expect.poll(async () => (await spoken(page)).slice(-2)).toEqual([love[0], love[0]])

    await press(page, readAloud.dockButton('Next sentence'))
    await expect.poll(() => marked(page)).toBe(love[1])
    await press(page, readAloud.dockButton('Previous sentence'))
    await expect.poll(() => marked(page)).toBe(love[0])

    await readAloud.openSheet()
    await expectNoSideways(page)
    await press(page, readAloud.sheetButton('Speed 1.0x'))
    await expect.poll(() => page.evaluate(() => window.__speech.at(-1)?.rate)).toBe(1.25)
    await expect(readAloud.sheetButton('Speed 1.25x')).toBeVisible()
  })

  test('turns the page at its end and the chapter at its end, without filling the history', async ({
    page,
    readAloud,
    readerPage,
  }) => {
    await page.clock.install()
    await readerPage.goto('the-prophet', 'the-coming-of-the-ship')
    const before = await page.evaluate(() => history.length)
    await press(page, readAloud.startButton)
    await runUntil(page, onPath(page, '/read/the-prophet/the-coming-of-the-ship/2'))
    await expect(page).toHaveURL('/read/the-prophet/the-coming-of-the-ship/2')
    await runUntil(page, onPath(page, ON_LOVE))
    await expect(page).toHaveURL(ON_LOVE)
    await expect.poll(() => spoken(page)).toContain('Chapter 2. On Love.')
    expect(await page.evaluate(() => history.length)).toBe(before)
  })

  test('a manual page turn stops following, and Follow the voice brings the page back', async ({ page, readAloud }) => {
    await startAt(readAloud, '/read/the-prophet/the-coming-of-the-ship')
    await press(page, readAloud.dockButton('Next sentence'))
    const first = said(0)[0] as string
    await expect.poll(() => marked(page)).toBe(first)
    await expect(readAloud.dockButton('Follow the voice')).toHaveCount(0)

    await press(page, page.getByRole('link', { name: 'Next page' }))
    await expect(page).toHaveURL('/read/the-prophet/the-coming-of-the-ship/2')
    await expect.poll(() => marked(page)).toBeNull()
    await press(page, readAloud.dockButton('Next sentence'))
    await expect(page).toHaveURL('/read/the-prophet/the-coming-of-the-ship/2')

    await press(page, readAloud.dockButton('Follow the voice'))
    await expect(page).toHaveURL('/read/the-prophet/the-coming-of-the-ship')
    await expect.poll(() => marked(page)).toBe(said(0)[1])
    await expect(readAloud.dockButton('Follow the voice')).toHaveCount(0)
  })

  test('keeps reading in the dock while browsing, and Go to page opens the voice’s page', async ({
    page,
    readAloud,
  }) => {
    await startAt(readAloud, ON_LOVE)
    await press(page, readAloud.dockButton('Next sentence'))
    await press(page, page.getByRole('link', { name: 'The Prophet' }).first())
    await expect(page).toHaveURL('/library/poetry-of-the-spirit/the-prophet')
    await expect(readAloud.dock).toContainText('Ch. 2 · p. 1 · Device voice')
    await press(page, readAloud.dockButton('Next sentence'))
    await expect.poll(() => lastSpoken(page)).toBe(love[1])

    await readAloud.openSheet()
    await expect(readAloud.sheet).toContainText('On Love')
    await expect(readAloud.sheet).toContainText(/About \d+ min left in this chapter|Less than a minute left/)
    await press(page, readAloud.sheetButton('Go to page'))
    await expect(page).toHaveURL(ON_LOVE)
    await expect.poll(() => marked(page)).toBe(love[1])
  })

  test('Read aloud from here starts at the sentence the selection is in', async ({ page }) => {
    await page.goto(ON_LOVE)
    await hang(page)
    const line = page.locator('#reader-content [data-highlight-root] p').nth(3)
    const text = (await line.textContent()) ?? ''
    await line.evaluate((el) => document.getSelection()?.selectAllChildren(el))
    await press(page, button(page, 'Read aloud from here'))
    await expect.poll(() => spoken(page)).toEqual([text])
    await expect.poll(() => marked(page)).toBe(text)
  })

  test('the voice menu lists the voices with the online label; the voice chosen and the sentence carry over a reload', async ({
    page,
    readAloud,
  }) => {
    await startAt(readAloud, ON_LOVE)
    await expect.poll(() => lastVoice(page)).toBe('Google US English')
    await press(page, readAloud.dockButton('Next sentence'))
    await press(page, readAloud.dockButton('Next sentence'))
    await press(page, readAloud.dockButton('Next sentence'))
    await expect.poll(() => marked(page)).toBe(love[2])
    await readAloud.openSheet()
    await expectAccessible(page)
    await press(page, readAloud.sheet.getByRole('button', { name: /^Voice/ }))
    const menu = page.getByRole('menu', { name: 'Voice' })
    await expect(menu.getByRole('menuitemradio')).toHaveText([/Google US English/, /Device English/])
    await expect(menu.getByRole('menuitemradio', { name: 'Google US English' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu).toContainText('Online: the text is sent to Google to be spoken')
    await expect(menu).toContainText('Voices come from your device.')
    await expect(menu).toHaveCSS('opacity', '1')
    await expectAccessible(page)
    await press(page, menu.getByRole('menuitemradio', { name: 'Device English' }))
    await expect.poll(() => lastVoice(page)).toBe('Device English')

    await press(page, readAloud.sheetButton('Minimize'))
    await press(page, readAloud.dockButton('Pause'))
    await page.reload()
    await hang(page)
    await press(page, readAloud.startButton)
    await expect.poll(() => spoken(page)).toEqual([love[2]])
    expect(await lastVoice(page)).toBe('Device English')
  })

  test('the sleep timer’s End of chapter stops at the chapter’s end', async ({ page, readAloud }) => {
    await page.clock.install()
    await startAt(readAloud, '/read/the-prophet/on-marriage')
    await readAloud.openSheet()
    await press(page, readAloud.sheet.getByRole('button', { name: 'Sleep timer' }))
    const menu = page.getByRole('menu', { name: 'Sleep timer' })
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      'Off',
      '15 min',
      '30 min',
      '45 min',
      '60 min',
      'End of chapter',
    ])
    await expect(menu).toHaveCSS('opacity', '1')
    await expectAccessible(page)
    await press(page, menu.getByRole('menuitemradio', { name: 'End of chapter' }))
    await press(page, readAloud.sheetButton('Minimize'))
    await expect(readAloud.dock).toContainText('Sleep · End of chapter')
    await hang(page, false)
    await press(page, readAloud.dockButton('Next sentence'))
    const ended = page.getByRole('status').filter({ hasText: 'Sleep timer ended' })
    await runUntil(page, () => ended.isVisible())
    await expect(ended).toBeVisible()
    await expect(readAloud.dockButton('Play')).toBeVisible()
    await expect(readAloud.dock).toContainText('Ch. 4 · p. 1')
    const last = said(2).at(-1)
    expect(await lastSpoken(page)).toBe(last)
  })

  test('keyboard only: Read aloud, the dock and the sheet without a pointer', async ({ page, readAloud }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A keyboard is a desktop thing; the phone is covered by touch.')
    await page.goto(ON_LOVE)
    await hang(page)
    await readAloud.startButton.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => spoken(page)).toEqual(['Chapter 2. On Love.'])
    await readAloud.dockButton('Next sentence').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => lastSpoken(page)).toBe(love[0])
    await readAloud.openButton.focus()
    await page.keyboard.press('Enter')
    await expect(readAloud.sheetButton('Minimize')).toBeFocused()
    await readAloud.sheet.getByRole('button', { name: /^Voice/ }).focus()
    await page.keyboard.press('Enter')
    const device = page.getByRole('menu', { name: 'Voice' }).getByRole('menuitemradio', { name: 'Device English' })
    await expect(async () => {
      await page.keyboard.press('ArrowDown')
      await expect(device).toBeFocused({ timeout: 500 })
    }).toPass()
    await page.keyboard.press('Enter')
    await expect.poll(() => lastVoice(page)).toBe('Device English')
    await page.keyboard.press('Escape')
    await expect(readAloud.sheet).toHaveCount(0)
  })

  test('is not offered when the reader is embedded', async ({ page, readAloud, readerPage }) => {
    await page.goto(`${ON_LOVE}?iframe=true`)
    if (!isWide(page)) await press(page, readerPage.contents.toolbarButton)
    await expect(readerPage.contents.nav).toBeVisible()
    await expect(readerPage.contents.tab('Highlights')).toHaveCount(0)
    await expect(readAloud.startButton).toHaveCount(0)
  })
})

test.describe('Read aloud from the book page', () => {
  test.beforeEach(async ({ page }) => fakeSpeech(page))

  test('starts in the dock without leaving the page; an audiobook and the voice stop each other', async ({
    page,
    audioPlayer,
    bookPage,
    readAloud,
  }) => {
    await bookPage.goto('poetry-of-the-spirit', 'the-prophet')
    await hang(page)
    await expect(button(page, 'Listen')).toBeVisible()
    await press(page, readAloud.startButton)
    await expect(readAloud.dock).toBeVisible()
    await expect(page).toHaveURL('/library/poetry-of-the-spirit/the-prophet')
    await expect.poll(() => spoken(page)).toEqual(['Chapter 1. The Coming of the Ship.'])
    await expect(button(page, 'Pause reading')).toBeVisible()

    await press(page, button(page, 'Listen'))
    await expect(audioPlayer.dock).toBeVisible()
    await expect(readAloud.dock).toHaveCount(0)
    await press(page, readAloud.startButton)
    await expect(readAloud.dock).toBeVisible()
    await expect(audioPlayer.dock).toHaveCount(0)
  })

  test('the sleep timer’s 15 minutes count while it reads, then it finishes the sentence and pauses', async ({
    page,
    bookPage,
    readAloud,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A timer, not a layout: once is enough.')
    await page.clock.install()
    await bookPage.goto('jane-austen', 'pride-and-prejudice')
    await press(page, readAloud.startButton)
    await expect(readAloud.dock).toBeVisible()
    await readAloud.openSheet()
    await press(page, readAloud.sheet.getByRole('button', { name: 'Sleep timer' }))
    await press(page, page.getByRole('menuitemradio', { name: '15 min' }))
    await press(page, readAloud.sheetButton('Minimize'))
    await expect(readAloud.dock).toContainText('Sleep · 15 min')
    for (let minute = 0; minute < 14; minute++) await page.clock.runFor(60_000)
    await expect(readAloud.dock).toContainText('Sleep · 1 min')
    await expect(readAloud.dockButton('Pause')).toBeVisible()
    await page.clock.runFor(60_000)
    const ended = page.getByRole('status').filter({ hasText: 'Sleep timer ended' })
    await runUntil(page, () => ended.isVisible())
    await expect(ended).toBeVisible()
    await expect(readAloud.dockButton('Play')).toBeVisible()
    await expect(readAloud.dock).not.toContainText('Sleep ·')
  })
})

test.describe('Read aloud without a voice', () => {
  test('a device with no voice for the language says so', async ({ page, readAloud }) => {
    await fakeSpeech(page, { voices: [{ name: 'Yelda', lang: 'tr-TR', localService: true }] })
    await page.goto(ON_LOVE)
    await press(page, readAloud.startButton)
    await expect(page.getByRole('status').filter({ hasText: 'This device has no English voice.' })).toContainText(
      'You can add one in your system’s speech settings.',
    )
    await expect(readAloud.dock).toHaveCount(0)
  })

  test('without speechSynthesis there is no Read aloud anywhere', async ({ page, readAloud }) => {
    await fakeSpeech(page, { none: true })
    await page.goto(ON_LOVE)
    await selectParagraph(page)
    await expect(button(page, 'Ask about this')).toBeVisible()
    await expect(button(page, 'Read aloud from here')).toHaveCount(0)
    await expect(readAloud.startButton).toHaveCount(0)
    await press(page, page.getByRole('link', { name: 'The Prophet' }).first())
    await expect(page).toHaveURL('/library/poetry-of-the-spirit/the-prophet')
    await expect(button(page, 'Listen')).toBeVisible()
    await expect(readAloud.startButton).toHaveCount(0)
  })
})

test.describe('Read aloud of a private book', () => {
  test('its owner has it read aloud, by an on-device voice the app picks itself', async ({
    page,
    baseURL,
    readAloud,
  }) => {
    await fakeSpeech(page)
    await createUser(page.request, { signedIn: true })
    const imported = await importViaApi(page.request, baseURL ?? '', {
      title: 'Aloud Diary',
      chapters: [
        { title: 'Opening', text: 'The first sentence of the diary. The second one.' },
        { title: 'Closing', text: 'The last chapter.' },
      ],
    })
    await page.goto(imported.href)
    await press(page, readAloud.startButton)
    await expect.poll(() => spoken(page)).toContain('The first sentence of the diary.')
    expect(await spoken(page)).toEqual(expect.arrayContaining(['Chapter 1. Opening.']))
    expect(await page.evaluate(() => window.__speech.map((s) => s.voice))).not.toContain('Google US English')
    expect(await page.evaluate(() => window.__speech[0]?.voice)).toBe(DEVICE_VOICE.name)
  })
})
