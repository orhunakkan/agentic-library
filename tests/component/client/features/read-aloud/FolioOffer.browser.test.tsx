import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import {
  deviceVoice,
  type FakeSpeech,
  fakeSpeech,
  mountReadAloud,
  openSheet,
  readAloudSheet as sheet,
} from '../../../../support/client/read-aloud'

/**
 * Real speech can't run in a test: audio, the Folio voice's Piper WASM and the browser's `speechSynthesis`. This is
 * the module that hands the player the browser's speakers and voices, so it alone is faked, with speakers that
 * record what they're asked to say and a voice store whose downloads the test moves on. The player, the read-aloud
 * controller and the components are the app's own.
 */
const speech = vi.hoisted(() => ({ current: null as FakeSpeech | null }))
vi.mock('~/client/features/read-aloud/browser-read-aloud', () => ({
  browserReadAloud: () => () => speech.current?.parts ?? null,
}))
/** The listening bookmarks load from a server function, which imports TanStack Start; signed out, none is called. */
vi.mock('~/server/account-functions', () => ({ getAudioBookmarks: vi.fn() }))

beforeEach(() => {
  localStorage.clear()
  speech.current = fakeSpeech({ voices: [deviceVoice('Samantha')], folio: true })
})

const offer = sheet.getByRole('region', { name: 'Try the Folio voice' })
const downloading = sheet.getByRole('region', { name: 'Folio voice' })
const progress = downloading.getByRole('progressbar', { name: 'Downloading the Folio voice' })
const lastDownload = () => {
  const download = speech.current?.downloads.at(-1)
  if (!download) throw new Error('No download has started')
  return download
}

describe('FolioOffer', () => {
  it('offers the Folio voice, with its size', async () => {
    await mountReadAloud()
    await openSheet()
    await expect.element(offer).toBeVisible()
    /** The offer's description is a plain paragraph, with no role of its own. */
    await expect.element(offer.getByText(/^A natural voice that sounds the same on every device/)).toBeVisible()
    await expect.element(offer.getByText(/About \d+ MB, downloaded once\.$/)).toBeVisible()
  })

  it('downloads the voice when accepted, showing how far it has got, and reads with it once it’s ready', async () => {
    await mountReadAloud()
    await openSheet()
    await offer.getByRole('button', { name: 'Download' }).click()
    await expect.element(downloading).toBeVisible()
    await expect.element(offer).not.toBeInTheDocument()
    await expect.element(downloading.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    lastDownload().progress(40)
    await expect.element(progress).toHaveAttribute('value', '40')
    /** The progress line is plain text, read out as it changes. */
    await expect.element(downloading.getByText('Downloading the Folio voice… 40%')).toBeVisible()
    lastDownload().finish('ok')
    await expect.element(page.getByRole('status').filter({ hasText: 'The Folio voice is ready.' })).toBeVisible()
    await expect.element(downloading).not.toBeInTheDocument()
    await expect.element(offer).not.toBeInTheDocument()
    /** The voice reading is plain text in the Voice button: the Folio voice offered for an American English reader. */
    await expect.element(sheet.getByTestId('voice-current')).toHaveTextContent('LJSpeech')
  })

  it('brings the offer back when the download is cancelled', async () => {
    await mountReadAloud()
    await openSheet()
    await offer.getByRole('button', { name: 'Download' }).click()
    await downloading.getByRole('button', { name: 'Cancel' }).click()
    await expect.element(downloading).not.toBeInTheDocument()
    await expect.element(offer).toBeVisible()
  })

  it('says so when the download fails', async () => {
    await mountReadAloud()
    await openSheet()
    await offer.getByRole('button', { name: 'Download' }).click()
    lastDownload().finish('failed')
    await expect
      .element(page.getByRole('status').filter({ hasText: 'Couldn’t download the Folio voice.' }))
      .toBeVisible()
    await expect.element(downloading).not.toBeInTheDocument()
  })

  it('goes away on Not now, and stays away', async () => {
    const view = await mountReadAloud()
    await openSheet()
    await offer.getByRole('button', { name: 'Not now' }).click()
    await expect.element(offer).not.toBeInTheDocument()
    expect(speech.current?.downloads).toEqual([])
    await sheet.getByRole('button', { name: 'Minimize' }).click()
    await expect.element(sheet).not.toBeInTheDocument()
    await page
      .getByRole('region', { name: 'Read aloud' })
      .getByRole('button', { name: /^Open player: / })
      .click()
    await expect.element(sheet).toBeVisible()
    await expect.element(offer).not.toBeInTheDocument()
    expect(view.state.location.pathname).toBe('/library/emerson/essays')
  })

  it('isn’t offered while the reader is offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await mountReadAloud()
    await openSheet()
    await expect.element(sheet.getByRole('button', { name: 'Previous chapter' })).toBeVisible()
    await expect.element(offer).not.toBeInTheDocument()
  })

  it('comes back when the connection does', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await mountReadAloud()
    await openSheet()
    await expect.element(offer).not.toBeInTheDocument()
    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await expect.element(offer).toBeVisible()
  })

  it('isn’t offered where the Folio voice can’t run', async () => {
    speech.current = fakeSpeech({ voices: [deviceVoice('Samantha')] })
    await mountReadAloud()
    await openSheet()
    await expect.element(sheet.getByRole('button', { name: 'Previous chapter' })).toBeVisible()
    await expect.element(offer).not.toBeInTheDocument()
  })

  it('isn’t offered once a Folio voice is on the device', async () => {
    speech.current = fakeSpeech({ voices: [deviceVoice('Samantha')], folio: true, downloaded: ['en_GB-cori-medium'] })
    await mountReadAloud()
    await openSheet()
    await expect.element(sheet.getByRole('button', { name: 'Previous chapter' })).toBeVisible()
    await expect.element(offer).not.toBeInTheDocument()
  })
})
