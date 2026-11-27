import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { LOCAL_NOTE } from '~/client/features/read-aloud/messages'
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
 * record what they're asked to say. The player, the read-aloud controller and the components are the app's own.
 */
const speech = vi.hoisted(() => ({ current: null as FakeSpeech | null }))
vi.mock('~/client/features/read-aloud/browser-read-aloud', () => ({
  browserReadAloud: () => () => speech.current?.parts ?? null,
}))
/** The listening bookmarks load from a server function, which imports TanStack Start; signed out, none is called. */
vi.mock('~/server/account-functions', () => ({ getAudioBookmarks: vi.fn() }))

const SAMANTHA = deviceVoice('Samantha', 'en-US')
const DANIEL = deviceVoice('Daniel', 'en-GB')
const ARIA = deviceVoice('Microsoft Aria Online (Natural)', 'en-US', { localService: false })

beforeEach(() => {
  localStorage.clear()
  speech.current = fakeSpeech({ voices: [SAMANTHA, DANIEL] })
})

/**
 * A voice's name is followed by its details in its item, and the Voice button by the voice reading. The app's CSS puts
 * each on a line or in a box of its own, so a screen reader hears them apart; without it, which these tests don't
 * load, the browser runs them together, so these match a name by how it starts.
 */
const startsWith = (name: string) => new RegExp(`^${name.replace(/[()]/g, '\\$&')}`)
const voiceButton = sheet.getByRole('button', { name: /^Voice/ })
const voiceReading = sheet.getByTestId('voice-current')
const menu = page.getByRole('menu', { name: 'Voice' })
const option = (name: string) => menu.getByRole('menuitemradio', { name: startsWith(name) })
const download = (name: string) => menu.getByRole('menuitem', { name: startsWith(name) })

async function openMenu() {
  await voiceButton.click()
  await expect.element(menu).toBeVisible()
}

describe('VoiceMenu', () => {
  it('names the voice reading, and lists the device’s voices with where they’re from', async () => {
    speech.current = fakeSpeech({ voices: [SAMANTHA, DANIEL, ARIA] })
    await mountReadAloud()
    await openSheet()
    /** The voice reading is plain text in the Voice button. */
    /** Read aloud picks a natural online voice first where the device has one. */
    await expect.element(voiceReading).toHaveTextContent('Microsoft Aria Online (Natural)')
    await openMenu()
    await expect.element(menu.getByText('On this device')).toBeVisible()
    await expect.element(option('Microsoft Aria Online (Natural)')).toHaveAttribute('aria-checked', 'true')
    await expect.element(option('Daniel')).toHaveAttribute('aria-checked', 'false')
    /** Each voice's details are plain text inside its item. */
    await expect.element(option('Daniel').getByText('United Kingdom')).toBeVisible()
    await expect
      .element(
        option('Microsoft Aria Online (Natural)').getByText(
          'United States · Online: the text is sent to Microsoft to be spoken',
        ),
      )
      .toBeVisible()
  })

  it('reads on in the voice the reader chooses, and remembers it', async () => {
    await mountReadAloud()
    await openSheet()
    await vi.waitFor(() => expect(speech.current?.lastVoice()).toBe('Samantha'))
    await openMenu()
    await option('Daniel').click()
    await expect.element(menu).not.toBeInTheDocument()
    await expect.element(voiceReading).toHaveTextContent('Daniel')
    await vi.waitFor(() => expect(speech.current?.lastVoice()).toBe('Daniel'))
    await openMenu()
    await expect.element(option('Daniel')).toHaveAttribute('aria-checked', 'true')
  })

  it('offers the browser’s default voice when the device lists none', async () => {
    speech.current = fakeSpeech({ voices: [] })
    await mountReadAloud()
    await openSheet()
    await expect.element(voiceButton).toHaveAccessibleName('Voice')
    await expect.element(voiceReading).not.toBeInTheDocument()
    await openMenu()
    /** With no voices listed there is nothing to choose, only a line saying what will read. */
    await expect.element(menu.getByText('The browser’s default voice')).toBeVisible()
    await expect.element(menu.getByRole('menuitemradio')).not.toBeInTheDocument()
  })

  it('offers the Folio voices to download, where the device can run them', async () => {
    speech.current = fakeSpeech({ voices: [SAMANTHA], folio: true })
    await mountReadAloud()
    await openSheet()
    await openMenu()
    await expect.element(menu.getByText('Folio voice', { exact: true })).toBeVisible()
    await expect.element(menu.getByText(startsWith(LOCAL_NOTE))).toBeVisible()
    await expect.element(menu.getByRole('menuitem', { name: 'Credits' })).toBeVisible()
    const cori = download('Cori')
    await expect.element(cori.getByText(/^Download · About \d+ MB$/)).toBeVisible()
    await cori.click()
    expect(speech.current?.downloads.map((d) => d.id)).toEqual(['en_GB-cori-medium'])
  })

  it('says a Folio voice can’t be downloaded offline', async () => {
    speech.current = fakeSpeech({ voices: [SAMANTHA], folio: true })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await mountReadAloud()
    await openSheet()
    await openMenu()
    const cori = download('Cori')
    await expect.element(cori).toHaveAttribute('aria-disabled', 'true')
    await expect.element(cori.getByText('Connect to the internet to download it.')).toBeVisible()
  })

  it('reads with a downloaded Folio voice, and offers to remove the Folio voices', async () => {
    speech.current = fakeSpeech({ voices: [SAMANTHA], folio: true, downloaded: ['en_GB-cori-medium'] })
    await mountReadAloud()
    await openSheet()
    await openMenu()
    const cori = option('Cori')
    await expect.element(cori.getByText(/On this device$/)).toBeVisible()
    await cori.click()
    await expect.element(voiceReading).toHaveTextContent('Cori')
    await openMenu()
    const remove = menu.getByRole('menuitem', { name: /^Remove Folio voices from this device/ })
    await remove.click()
    await vi.waitFor(() => expect(speech.current?.voiceStore.remove).toHaveBeenCalledOnce())
  })
})
