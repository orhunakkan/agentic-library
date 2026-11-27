import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import {
  deviceVoice,
  readAloudDock as dock,
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

beforeEach(() => {
  localStorage.clear()
  speech.current = fakeSpeech({ voices: [deviceVoice('Samantha')] })
})

const said = () => speech.current?.said ?? []
const previousChapter = sheet.getByRole('button', { name: 'Previous chapter' })
const nextChapter = sheet.getByRole('button', { name: 'Next chapter' })

describe('SpeechSheet', () => {
  it('shows the chapter being read, the time left in it and where in it the voice is', async () => {
    await mountReadAloud()
    await openSheet()
    /** The chapter number, time left and page are plain text in the sheet, with no role of their own. */
    await expect.element(sheet.getByText('Chapter 1', { exact: true })).toBeVisible()
    await expect.element(sheet.getByRole('button', { name: 'History' })).toBeVisible()
    await expect.element(sheet.getByTestId('speech-time-left')).toHaveTextContent('About 1 min left in this chapter')
    await expect.element(sheet.getByTestId('speech-page-label')).toHaveTextContent('Ch. 1 · p. 1')
    await expect
      .element(sheet.getByRole('slider', { name: 'Progress' }))
      .toHaveAttribute('aria-valuetext', '0% of the chapter')
  })

  it('pauses and plays again', async () => {
    await mountReadAloud()
    await openSheet()
    await sheet.getByRole('button', { name: 'Pause' }).click()
    await expect.element(sheet.getByRole('button', { name: 'Play' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Play' }).click()
    await expect.element(sheet.getByRole('button', { name: 'Pause' })).toBeVisible()
  })

  it('moves between chapters, with no chapter before the first or after the last', async () => {
    await mountReadAloud()
    await openSheet()
    await expect.element(previousChapter).toBeDisabled()
    await nextChapter.click()
    await expect.element(sheet.getByRole('button', { name: 'Self-Reliance' })).toBeVisible()
    await expect.element(sheet.getByText('Chapter 2', { exact: true })).toBeVisible()
    await expect.element(nextChapter).toBeDisabled()
    await vi.waitFor(() => expect(said().at(-1)).toBe('Chapter 2. Self-Reliance.'))
    await previousChapter.click()
    await expect.element(sheet.getByRole('button', { name: 'History' })).toBeVisible()
  })

  it('moves to the next and the previous sentence', async () => {
    await mountReadAloud()
    await openSheet()
    await vi.waitFor(() => expect(said().at(-1)).toBe('Chapter 1. History.'))
    await sheet.getByRole('button', { name: 'Next sentence' }).click()
    await vi.waitFor(() => expect(said().at(-1)).toBe('One mind.'))
    await sheet.getByRole('button', { name: 'Next sentence' }).click()
    await vi.waitFor(() => expect(said().at(-1)).toBe('Two minds.'))
    await sheet.getByRole('button', { name: 'Previous sentence' }).click()
    await vi.waitFor(() => expect(said().at(-1)).toBe('One mind.'))
  })

  it('moves through the chapter with the progress slider', async () => {
    await mountReadAloud()
    await openSheet()
    const slider = sheet.getByRole('slider', { name: 'Progress' })
    ;(slider.element() as HTMLElement).focus()
    await userEvent.keyboard('{End}')
    /** The end of the chapter is its last sentence, which the slider then shows as how far in it starts. */
    await vi.waitFor(() => expect(said().at(-1)).toBe('Three.'))
    await expect.element(sheet.getByTestId('speech-page-label')).toHaveTextContent('Ch. 1 · p. 2')
    await expect.element(slider).not.toHaveAttribute('aria-valuetext', '0% of the chapter')
  })

  it('goes to the page being read from the chapter’s title, and minimizes', async () => {
    const router = await mountReadAloud()
    await openSheet()
    await sheet.getByRole('button', { name: 'History' }).click()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/read/essays/history'))
    await expect.element(sheet).not.toBeInTheDocument()
    await expect.element(dock).toBeVisible()
  })

  it('minimizes to the dock on Escape', async () => {
    await mountReadAloud()
    await openSheet()
    await userEvent.keyboard('{Escape}')
    await expect.element(sheet).not.toBeInTheDocument()
    await expect.element(dock).toBeVisible()
  })

  it('closes the player', async () => {
    await mountReadAloud()
    await openSheet()
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.element(sheet).not.toBeInTheDocument()
    await expect.element(dock).not.toBeInTheDocument()
  })

  it('reads faster with the speed button', async () => {
    await mountReadAloud()
    await openSheet()
    const speed = sheet.getByRole('button', { name: /^Speed / })
    await expect.element(speed).toHaveAccessibleName('Speed 1.0x')
    await speed.click()
    await expect.element(speed).toHaveAccessibleName('Speed 1.25x')
  })

  it('says the next part couldn’t be loaded, and tries again on Retry', async () => {
    const fake = fakeSpeech({ voices: [deviceVoice('Samantha')] })
    const fetchChapter = fake.parts.controller.fetchChapter
    let failing = true
    fake.parts.controller.fetchChapter = async (book, index) =>
      index === 1 && failing ? { ok: false, reason: 'failed' } : fetchChapter(book, index)
    speech.current = fake
    await mountReadAloud()
    await openSheet()
    await nextChapter.click()
    const problem = sheet.getByRole('status').filter({ hasText: 'Couldn’t load the next part of the book.' })
    await expect.element(problem).toBeVisible()
    failing = false
    await problem.getByRole('button', { name: 'Retry' }).click()
    await expect.element(sheet.getByRole('button', { name: 'Self-Reliance' })).toBeVisible()
    await expect.element(problem).not.toBeInTheDocument()
  })
})
