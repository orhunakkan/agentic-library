import type { Page, Request } from '@playwright/test'
import { isWide, type ReaderPage } from '../pages'
import { createUser, saveKey, validKey } from '../support/accounts'
import { fakeRecognition, sessions, speechEnds, willHear } from '../support/fake-recognition'
import { fakeSpeech, spoken } from '../support/fake-speech'
import { expect, expectAccessible, test } from '../support/fixtures'

const PAGE = '/read/pride-and-prejudice/chapter-6/3'

async function askOpen(page: Page, readerPage: ReaderPage) {
  await createUser(page.request, { signedIn: true })
  await saveKey(page, validKey('0000'))
  await page.goto(PAGE)
  return readerPage.ask.open()
}

function askRequests(page: Page) {
  const bodies: Record<string, unknown>[] = []
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && /^\/read\/[^/]+\/ask$/.test(new URL(r.url()).pathname))
      bodies.push(r.postDataJSON() as Record<string, unknown>)
  })
  return bodies
}

const ANSWER_SPOKEN = [
  expect.stringMatching(/^I can see \d+ pages of the book\.$/),
  'Your page says so.',
  'For example:',
  'Code example.',
]

test.describe('Ask by voice', () => {
  test('on the device: downloads the language, hears the question, sends it and reads the answer; Listen reads it again', async ({
    page,
    readerPage,
  }) => {
    await fakeSpeech(page)
    await fakeRecognition(page, { local: 'downloadable' })
    const bodies = askRequests(page)
    const ask = await askOpen(page, readerPage)

    await readerPage.ask.microphone.click()
    const offer = ask.getByTestId('ask-voice-offer')
    await expect(offer).toContainText(
      'Download speech recognition for English? It’s recognised on this device, so nothing you say leaves it.',
    )
    await expectAccessible(page)

    await willHear(page, { interim: 'Who is' }, { interim: 'Who is Mr Darcy?' }, { hold: true })
    await offer.getByRole('button', { name: 'Download' }).click()
    await expect(ask.getByText('Speech recognition is ready.')).toBeVisible()
    await expect(readerPage.ask.voiceStatus).toHaveText('Listening…')
    await expect(readerPage.ask.microphone).toHaveAttribute('aria-pressed', 'true')
    await expect(readerPage.ask.microphone).toHaveAccessibleName('Stop and send')
    await expect(readerPage.ask.questionBox).toHaveValue('Who is Mr Darcy?')
    await expectAccessible(page)
    expect(await sessions(page)).toEqual([{ lang: 'en-GB', processLocally: true }])

    await speechEnds(page)
    await expect(ask.getByTestId('ask-question').getByText('Who is Mr Darcy?')).toBeVisible()
    await expect(ask.getByRole('button', { name: 'Copy' })).toBeVisible()
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ question: 'Who is Mr Darcy?', spoken: true })

    await expect.poll(() => spoken(page)).toEqual(ANSWER_SPOKEN)
    await expect(readerPage.ask.voiceStatus).toHaveText('')

    await readerPage.ask.listen(1).click()
    await expect.poll(async () => (await spoken(page)).length).toBe(8)
    const said = await spoken(page)
    expect(said.slice(4)).toEqual(said.slice(0, 4))
  })

  test('online: asks first, shows a refusal, Cancel sends nothing, and Read answers aloud stays off', async ({
    page,
    readerPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Online recognition in desktop Chrome, once.')
    await fakeSpeech(page)
    await fakeRecognition(page)
    const bodies = askRequests(page)
    const ask = await askOpen(page, readerPage)

    await readerPage.ask.microphone.click()
    const note = ask.getByTestId('ask-voice-online-note')
    await expect(note).toHaveText(
      /To turn your voice into text, your browser sends what you say to Google\. Folio gets only the text\./,
    )
    await willHear(page, { error: 'not-allowed' })
    await note.getByRole('button', { name: 'Use voice' }).click()
    await expect(ask.getByRole('alert')).toHaveText(
      'Folio can’t use the microphone. Allow it in your browser’s site settings, then try again.',
    )

    await willHear(page, { interim: 'Never mind' }, { hold: true })
    await readerPage.ask.microphone.click()
    await expect(note).toBeHidden()
    await expect(readerPage.ask.questionBox).toHaveValue('Never mind')
    await ask.getByRole('button', { name: 'Cancel' }).click()
    await expect(readerPage.ask.voiceStatus).toHaveText('')
    await expect(readerPage.ask.questionBox).toHaveValue('')
    expect(await sessions(page)).toEqual([
      { lang: 'en-GB', processLocally: false },
      { lang: 'en-GB', processLocally: false },
    ])
    expect(bodies).toEqual([])

    const settings = await readerPage.ask.openVoiceSettings()
    await expect(settings.getByText('Your browser sends what you say to Google to turn it into text.')).toBeVisible()
    await settings.getByRole('switch', { name: 'Read answers aloud' }).click()
    await expect(settings.getByRole('switch', { name: 'Read answers aloud' })).not.toBeChecked()
    await page.keyboard.press('Escape')
    await willHear(page, { interim: 'What happens' }, { final: 'What happens next?' })
    await readerPage.ask.microphone.click()
    await expect(ask.getByRole('button', { name: 'Copy' })).toBeVisible()
    expect(bodies[0]).toMatchObject({ question: 'What happens next?', spoken: true })
    expect(await spoken(page)).toEqual([])

    await page.reload()
    if (!isWide(page)) await readerPage.ask.open()
    const again = await readerPage.ask.openVoiceSettings()
    await expect(again.getByRole('switch', { name: 'Read answers aloud' })).not.toBeChecked()
  })
})
