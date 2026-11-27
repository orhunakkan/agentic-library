import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import {
  deviceVoice,
  readAloudDock as dock,
  type FakeSpeech,
  fakeSpeech,
  mountReadAloud as mountDock,
  readAloudSheet as sheet,
  startReading,
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

beforeEach(() => {
  localStorage.clear()
  speech.current = fakeSpeech({ voices: [deviceVoice('Samantha')] })
})

const said = () => speech.current?.said ?? []

/** Lets the voice finish naming the chapter, which it says before the chapter's first sentence. */
async function pastIntro() {
  await vi.waitFor(() => expect(said().at(-1)).toBe('Chapter 1. History.'))
  speech.current?.finish()
  await vi.waitFor(() => expect(said().at(-1)).toBe('One mind.'))
}

describe('SpeechDock', () => {
  it('stays off the page until something is read aloud', async () => {
    await mountDock()
    await expect.element(dock).not.toBeInTheDocument()
  })

  it('shows the book, the page and the voice being read, and reads the chapter', async () => {
    await mountDock()
    await startReading()
    /** The book's title and what's playing are plain text in the summary button, with no role of their own. */
    await expect.element(dock.getByTestId('player-dock-title')).toHaveTextContent('Essays')
    await expect.element(dock.getByTestId('player-dock-subtitle')).toHaveTextContent('Ch. 1 · p. 1 · Device voice')
    await vi.waitFor(() => expect(said()).toEqual(['Chapter 1. History.']))
    speech.current?.finish()
    await vi.waitFor(() => expect(said()).toEqual(['Chapter 1. History.', 'One mind.']))
  })

  it('pauses and plays again', async () => {
    await mountDock()
    await startReading()
    await dock.getByRole('button', { name: 'Pause' }).click()
    await expect.element(dock.getByRole('button', { name: 'Play' })).toBeVisible()
    const before = said().length
    await dock.getByRole('button', { name: 'Play' }).click()
    await expect.element(dock.getByRole('button', { name: 'Pause' })).toBeVisible()
    await vi.waitFor(() => expect(said().length).toBeGreaterThan(before))
  })

  it('moves to the next and the previous sentence', async () => {
    await mountDock()
    await startReading()
    await pastIntro()
    await dock.getByRole('button', { name: 'Next sentence' }).click()
    await vi.waitFor(() => expect(said().at(-1)).toBe('Two minds.'))
    await dock.getByRole('button', { name: 'Previous sentence' }).click()
    await vi.waitFor(() => expect(said().at(-1)).toBe('One mind.'))
  })

  it('reads on to the next sentence when the voice has said one', async () => {
    await mountDock()
    await startReading()
    await pastIntro()
    speech.current?.finish()
    await vi.waitFor(() => expect(said().at(-1)).toBe('Two minds.'))
  })

  it('opens the sheet from the book’s summary, and comes back to the dock on Minimize', async () => {
    await mountDock()
    await startReading()
    await dock.getByRole('button', { name: /^Open player: / }).click()
    await expect.element(sheet).toBeVisible()
    await expect.element(dock).not.toBeInTheDocument()
    await sheet.getByRole('button', { name: 'Minimize' }).click()
    await expect.element(dock).toBeVisible()
    await expect.element(sheet).not.toBeInTheDocument()
  })

  it('closes the player', async () => {
    await mountDock()
    await startReading()
    await dock.getByRole('button', { name: 'Close player' }).click()
    await expect.element(dock).not.toBeInTheDocument()
  })

  it('offers to follow the voice to its page from elsewhere, and goes there', async () => {
    const router = await mountDock()
    await startReading()
    const follow = dock.getByRole('button', { name: 'Follow the voice' })
    await follow.click()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/read/essays/history'))
    await expect.element(follow).not.toBeInTheDocument()
  })

  it('doesn’t offer to follow the voice on its own page while following it', async () => {
    await mountDock('/read/essays/history')
    await startReading()
    await expect.element(dock.getByRole('button', { name: 'Follow the voice' })).not.toBeInTheDocument()
  })

  it('says so, and closes, when the device has no voice in the book’s language', async () => {
    speech.current = fakeSpeech({ voices: [deviceVoice('Amélie', 'fr-FR')] })
    await mountDock()
    await page.getByRole('button', { name: 'Read aloud', exact: true }).click()
    await expect
      .element(page.getByRole('status').filter({ hasText: 'This device has no English voice.' }))
      .toBeVisible()
    await expect.element(dock).not.toBeInTheDocument()
    expect(said()).toEqual([])
  })
})
