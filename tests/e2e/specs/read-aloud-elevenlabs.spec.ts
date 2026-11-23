import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { BookContent } from '../../../src/shared/content/schema.ts'
import { utterances } from '../../../src/shared/read-aloud/sentences.ts'
import { speechChapter } from '../../../src/shared/read-aloud/speech-text.ts'
import { press, type ReadAloud } from '../pages'
import { createUser, saveKey } from '../support/accounts'
import { elevenLabsKey, STUB_ELEVENLABS_KEYS, type StubSpeechRequest } from '../support/elevenlabs-stub'
import { fakeSpeech, hang, marked, spoken } from '../support/fake-speech'
import { expect, expectAccessible, test } from '../support/fixtures'

const prophet = JSON.parse(readFileSync('tests/e2e/content/books/the-prophet.json', 'utf8')) as BookContent
const ON_LOVE = '/read/the-prophet/on-love'
const love = (() => {
  const page = speechChapter(prophet, 1)?.pages[0]
  if (!page) throw new Error('no On Love')
  return utterances(page, 'en').map((u) => u.say)
})()

const ownKey = (ending = '') => elevenLabsKey(ending, randomBytes(6).toString('hex'))

async function stubRequests(page: Page, key: string): Promise<StubSpeechRequest[]> {
  const response = await page.request.get(`/test-elevenlabs/requests?key=${encodeURIComponent(key)}`)
  return response.json()
}

async function startReading(readAloud: ReadAloud) {
  await hang(readAloud.page)
  await readAloud.start()
  await expect.poll(() => spoken(readAloud.page)).toContain('Chapter 2. On Love.')
}

async function openVoiceMenu(readAloud: ReadAloud) {
  const { page } = readAloud
  if (!(await readAloud.sheet.isVisible())) await readAloud.openSheet()
  await press(page, readAloud.sheet.getByRole('button', { name: /^Voice/ }))
  await expect(readAloud.voiceMenu).toBeVisible()
  return readAloud.voiceMenu
}

async function pickVoice(readAloud: ReadAloud, name: string) {
  const menu = await openVoiceMenu(readAloud)
  const item = menu.getByRole('menuitemradio', { name })
  await expect(item).toBeVisible()
  await press(readAloud.page, item)
  await expect(readAloud.voiceMenu).toBeHidden()
}

const closeSheet = async (readAloud: ReadAloud) => {
  await readAloud.page.keyboard.press('Escape')
  await expect(readAloud.sheet).toBeHidden()
}

const hasWordMark = (page: Page) => page.evaluate(() => CSS.highlights.has('ra-word'))

test.describe('Read aloud with an ElevenLabs voice', () => {
  test('without a key the Voice menu points to the API keys page; with one, it reads once picked, until out of credits', async ({
    page,
    readAloud,
  }) => {
    await fakeSpeech(page)
    await createUser(page.request, { signedIn: true })
    await page.goto(ON_LOVE)

    await startReading(readAloud)
    let menu = await openVoiceMenu(readAloud)
    await expect(menu).toContainText('Use an ElevenLabs voice: add your key on the API keys page.')
    await expect(menu.getByRole('menuitem', { name: 'add your key on the API keys page' })).toHaveAttribute(
      'href',
      '/account/api-keys#elevenlabs',
    )
    await expect(menu.getByText('ElevenLabs', { exact: true })).toHaveCount(0)

    const key = ownKey()
    await saveKey(page, key, 'elevenlabs')
    await page.reload()
    await startReading(readAloud)
    await expect(readAloud.dock).toContainText('Device voice')
    menu = await openVoiceMenu(readAloud)
    await expect(menu.getByText('On this device', { exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitemradio', { name: 'Aria' })).toContainText('British · female')
    await expect(menu.getByRole('menuitemradio', { name: 'Aria' })).toContainText(
      'Online: sent to ElevenLabs on your key · about $2.20 an hour',
    )
    await expect(menu.getByRole('menuitemradio', { name: 'Aria' })).toHaveAttribute('aria-checked', 'false')
    await expectAccessible(page)
    await page.keyboard.press('Escape')
    await expect(readAloud.voiceMenu).toBeHidden()

    await pickVoice(readAloud, 'Aria')
    const deviceSaid = (await spoken(page)).length
    await closeSheet(readAloud)
    await expect(readAloud.dock).toContainText('ElevenLabs')
    await expect.poll(() => readAloud.speechPlaying()).toBe(true)
    await expect.poll(() => hasWordMark(page)).toBe(true)

    await press(page, readAloud.dockButton('Pause'))
    await expect.poll(() => readAloud.speechPlaying()).toBe(false)
    const before = await marked(page)
    expect(before).not.toBeNull()
    await press(page, readAloud.dockButton('Next sentence'))
    await expect.poll(() => marked(page)).not.toBe(before)
    const at = love.indexOf(before ?? '')
    if (at >= 0 && at + 1 < love.length) expect(await marked(page)).toBe(love[at + 1])
    await press(page, readAloud.dockButton('Play'))
    await expect.poll(() => readAloud.speechPlaying()).toBe(true)

    const texts = (await stubRequests(page, key)).map((r) => r.body.text)
    expect(texts.some((t) => love.includes(String(t)))).toBe(true)
    expect(await spoken(page)).toHaveLength(deviceSaid)

    await saveKey(page, ownKey(STUB_ELEVENLABS_KEYS.noCredits), 'elevenlabs')
    await press(page, readAloud.dockButton('Next sentence'))
    await expect(readAloud.dock).toContainText('Your ElevenLabs account is out of credits.')
    await expect(readAloud.dockButton('Play')).toBeVisible()
    await expect(readAloud.dock.getByRole('button', { name: 'Use device voice' })).toBeVisible()
    await expectAccessible(page)
  })
})
