import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { BookContent } from '../../../src/shared/content/schema.ts'
import { utterances } from '../../../src/shared/read-aloud/sentences.ts'
import { speechChapter } from '../../../src/shared/read-aloud/speech-text.ts'
import { press, type ReadAloud } from '../pages'
import { fakePiper, piperSaid } from '../support/fake-piper'
import { fakeSpeech, lastSpoken, marked, spoken } from '../support/fake-speech'
import { expect, expectAccessible, test } from '../support/fixtures'

const BOOK = 'pride-and-prejudice'
const SERIES = 'jane-austen'
const CHAPTER_1 = `/read/${BOOK}/chapter-1`

const pride = JSON.parse(readFileSync(`tests/e2e/content/books/${BOOK}.json`, 'utf8')) as BookContent
const chapterOne = (() => {
  const chapter = speechChapter(pride, 0)
  if (!chapter) throw new Error('no chapter 1')
  return new Set(chapter.pages.flatMap((p) => utterances(p, 'en-GB').map((u) => u.say)))
})()

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text })

const toastOnTop = (page: Page, text: string) =>
  page.evaluate((said) => {
    const shown = [...document.querySelectorAll('[role="status"] > *')].find((el) => el.textContent === said)
    if (!shown) return false
    const holder = shown.parentElement as HTMLElement
    holder.style.pointerEvents = 'auto'
    const box = shown.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    holder.style.pointerEvents = ''
    return top !== null && shown.contains(top)
  }, text)

async function closeSheet(readAloud: ReadAloud) {
  await readAloud.page.keyboard.press('Escape')
  await expect(readAloud.sheet).toBeHidden()
}

async function startReading(readAloud: ReadAloud, href = CHAPTER_1) {
  await readAloud.page.goto(href)
  await readAloud.start()
  await readAloud.openSheet()
}

async function downloadFromOffer(readAloud: ReadAloud) {
  await expect(readAloud.offer).toBeVisible()
  await press(readAloud.page, readAloud.offer.getByRole('button', { name: 'Download' }))
  await expect(toast(readAloud.page, 'The Folio voice is ready.')).toBeVisible()
}

test.describe('The Folio voice', () => {
  test.beforeEach(async ({ page }) => {
    await fakeSpeech(page)
    await fakePiper(page)
  })

  test('a reader downloads it from the offer, hears the next sentence in it, and has it chosen by itself after', async ({
    page,
    readAloud,
  }) => {
    await startReading(readAloud)
    await expect(readAloud.dock).toContainText('Device voice')
    await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0)
    await expect(readAloud.offer).toContainText('Try the Folio voice')
    await expect(readAloud.offer).toContainText(/About \d+ MB, downloaded once\./)
    await expectAccessible(page)

    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/voices/*.onnx', async (route) => {
      await held
      await route.continue().catch(() => {})
    })
    await press(page, readAloud.offer.getByRole('button', { name: 'Download' }))
    await expect(readAloud.offerDownload).toContainText(/Downloading the Folio voice… \d+%/)
    await expect(
      readAloud.offerDownload.getByRole('progressbar', { name: 'Downloading the Folio voice' }),
    ).toBeVisible()
    await expect(readAloud.offerDownload.getByRole('button', { name: 'Cancel' })).toBeFocused()
    release()
    await expect(toast(page, 'The Folio voice is ready.')).toBeVisible()
    expect(await toastOnTop(page, 'The Folio voice is ready.')).toBe(true)
    await expect(readAloud.offer).toHaveCount(0)

    await expect.poll(() => readAloud.speechPlaying(), { timeout: 15_000 }).toBe(true)
    await closeSheet(readAloud)
    await expect(readAloud.dock).toContainText('Folio voice')
    const asked = await piperSaid(page)
    expect(asked.length).toBeGreaterThan(0)
    for (const text of asked) expect(chapterOne.has(text), text).toBe(true)

    await page.reload()
    await readAloud.start()
    await expect(readAloud.dock).toContainText('Folio voice')
    await readAloud.openSheet()
    await expect(readAloud.offer).toHaveCount(0)
    const menu = await readAloud.openVoiceMenu()
    await expect(menu.getByText('Folio voice', { exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitemradio', { name: 'Cori' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByRole('menuitemradio', { name: 'Cori' })).toContainText(
      'United Kingdom · female · On this device',
    )
    await expect(menu.getByRole('menuitem', { name: 'LJSpeech' })).toContainText(/Download · About \d+ MB/)
    await expect(menu).toContainText('Plays on this device. The book’s text isn’t sent anywhere.')
    await expect(menu.getByRole('menuitem', { name: 'Credits' })).toBeVisible()
    await expectAccessible(page)

    await press(page, menu.getByRole('menuitem', { name: /^Remove Folio voices from this device \(\d+ MB\)$/ }))
    await expect(readAloud.voiceMenu).toBeHidden()
    await expect(readAloud.offer).toBeVisible()
    await closeSheet(readAloud)
    await expect(readAloud.dock).toContainText('Device voice')
    expect(await page.evaluate(() => caches.has('folio-voices-v1'))).toBe(false)
  })

  test('a download that fails says so over the sheet, and the offer comes back', async ({
    page,
    readAloud,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The toast is the same on every layout.')
    await page.route('**/voices/*.onnx', (route) => route.fulfill({ status: 404, body: 'Not found' }))
    await startReading(readAloud)
    await press(page, readAloud.offer.getByRole('button', { name: 'Download' }))
    const failed = 'Couldn’t download the Folio voice. Check your connection and try again.'
    await expect(toast(page, failed)).toBeVisible()
    expect(await toastOnTop(page, failed)).toBe(true)
    await expect(readAloud.offer).toBeVisible()
    expect(await page.evaluate(async () => (await (await caches.open('folio-voices-v1')).keys()).length)).toBe(0)
  })

  test('Not now keeps the offer away, and a voice that can’t start offers the device voice', async ({
    page,
    readAloud,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The offer and the problem look the same on every layout.')
    await startReading(readAloud)
    await press(page, readAloud.offer.getByRole('button', { name: 'Not now' }))
    await expect(readAloud.offer).toHaveCount(0)
    await page.reload()
    await startReading(readAloud)
    await expect(readAloud.offer).toHaveCount(0)

    const menu = await readAloud.openVoiceMenu()
    await press(page, menu.getByRole('menuitem', { name: 'Cori' }))
    await expect(readAloud.voiceMenu).toBeHidden()
    await expect(toast(page, 'The Folio voice is ready.')).toBeVisible()
    await closeSheet(readAloud)
    await expect(readAloud.dock).toContainText('Folio voice')

    await page.evaluate(() => (window.__piperFail = 'local_failed'))
    await expect(readAloud.dock).toContainText('The Folio voice couldn’t start on this device.')
    const stuck = await marked(page)
    expect(stuck).toBeTruthy()
    await press(page, readAloud.dock.getByRole('button', { name: 'Use device voice' }))
    await expect(readAloud.dock).toContainText('Device voice')
    await expect.poll(() => lastSpoken(page)).toBe(stuck)
  })
})

test.describe('Credits', () => {
  test('the footer’s Credits lists every voice’s licence and the GPL’s sources', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A page of prose, the same on every layout.')
    await page.goto('/library')
    await page.getByRole('contentinfo').getByRole('link', { name: 'Credits' }).click()
    await expect(page).toHaveURL('/credits')
    await expect(page.getByRole('heading', { level: 1, name: 'Credits' })).toBeVisible()
    const voices = page.getByRole('region', { name: 'Voices' })
    await expect(voices.getByRole('listitem').filter({ hasText: 'Cori' })).toContainText(
      'Cori, British English, by Cori Samuel',
    )
    await expect(
      voices.getByRole('listitem').filter({ hasText: 'Cori' }).getByRole('link', { name: 'CC BY 4.0' }).first(),
    ).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/')
    const card = voices.getByRole('listitem').filter({ hasText: 'Cori' }).getByRole('link', { name: 'Model card' })
    const response = await page.request.get((await card.getAttribute('href')) ?? '')
    expect(response.headers()['content-type']).toBe('text/markdown; charset=utf-8')
    const software = page.getByRole('region', { name: 'Software' })
    await expect(software).toContainText('piper-wasm 1.0.0')
    await expect(software.getByRole('link', { name: 'GPL-3.0' }).first()).toHaveAttribute(
      'href',
      'https://www.gnu.org/licenses/gpl-3.0.html',
    )
    await expectAccessible(page)
  })
})

test.describe('The Folio voice offline', () => {
  test.use({ serviceWorkers: 'allow' })

  test('reads a downloaded book with the connection off', async ({
    page,
    context,
    bookPage,
    downloadControl,
    readAloud,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Offline reading is offline.spec’s on the other layouts.')
    await fakeSpeech(page)
    await fakePiper(page)
    await startReading(readAloud)
    await downloadFromOffer(readAloud)
    await closeSheet(readAloud)
    await press(page, readAloud.dockButton('Close player'))

    await bookPage.goto(SERIES, BOOK)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller))
    await downloadControl.download()
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith('folio-app-'))))
      .toBe(true)
    await context.setOffline(true)

    await page.goto(CHAPTER_1)
    const said = (await piperSaid(page)).length
    await readAloud.start()
    await expect(readAloud.dock).toContainText('Folio voice')
    await expect.poll(async () => (await piperSaid(page)).length).toBeGreaterThan(said)
    await expect.poll(() => readAloud.speechPlaying(), { timeout: 15_000 }).toBe(true)
  })
})
