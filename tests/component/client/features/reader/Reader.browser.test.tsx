import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import { PlayerProvider } from '~/client/features/player/PlayerProvider'
import { PREFS_AT_KEY, PREFS_KEY } from '~/client/features/reader/prefs'
import { Reader } from '~/client/features/reader/Reader'
import { buildReaderView } from '~/shared/content/reader-view'
import { chapterFixture, metaFor } from '../../../../fixtures/books'
import { fixtureCatalog } from '../../../../fixtures/catalog'
import { mountAt } from '../../../../support/client/router'

/**
 * The Reader's hooks load highlights, bookmarks, voices and the reading place from server functions, which import
 * TanStack Start. A signed-out reader that only opens panels calls none of them.
 */
vi.mock('~/server/functions', () => ({ getReaderPage: vi.fn(), getSpeechChapter: vi.fn() }))
vi.mock('~/server/account-functions', () => ({
  getAskSetup: vi.fn(),
  getAudioBookmarks: vi.fn(),
  getBookBookmarks: vi.fn(),
  getBookHighlights: vi.fn(),
  getReadingPlace: vi.fn(),
  getSpeechVoices: vi.fn(),
}))

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

/** Opening the docked Ask panel is saved with the reader's settings, so each test starts from the defaults. */
beforeEach(() => {
  localStorage.removeItem(PREFS_KEY)
  localStorage.removeItem(PREFS_AT_KEY)
})

async function mountReader() {
  const view = buildReaderView({ meta: metaFor('essays'), catalog: fixtureCatalog }, chapterFixture, 'history')
  if (!view) throw new Error('The fixture has no History chapter')
  await mountAt(
    view.canonicalPath,
    <ToastProvider>
      <PlayerProvider>
        <Reader view={view} signedIn={false} />
      </PlayerProvider>
    </ToastProvider>,
  )
  await expect.element(page.getByRole('complementary', { name: 'Book contents panel' })).toBeInTheDocument()
}

/**
 * The bar across the top that a phone shows, and the floating buttons a desktop shows, are both on the page; CSS hides
 * one of them at each width. Browser tests don't load Tailwind, so these tests press the button a reader at that
 * width would see, and check what the Reader does with it at that width.
 *
 * The phone bar's Contents button is found by its test id because the desktop's Show contents button, which CSS
 * hides until the panel is collapsed, has the same name.
 */
const phoneContentsButton = page.getByTestId('reader-contents')
const phoneAskButton = page.getByRole('button', { name: 'Ask this book', exact: true })
const desktopAskButton = page.getByRole('button', { name: 'Ask', exact: true })
const contentsDrawer = page.getByRole('dialog', { name: 'Contents' })
const askSheet = page.getByRole('dialog', { name: 'Ask this book' })
const askPanel = page.getByRole('complementary', { name: 'Ask this book' })
const askState = () => document.documentElement.getAttribute('data-reader-ask')

describe('Reader at phone width', () => {
  it('opens Contents as a drawer over the page', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    await mountReader()
    await expect.element(phoneContentsButton).toHaveRole('button')
    await expect.element(phoneContentsButton).toHaveAccessibleName('Contents')
    await expect.element(contentsDrawer).not.toBeInTheDocument()
    await phoneContentsButton.click()
    await expect.element(contentsDrawer).toBeVisible()
    await expect.element(phoneContentsButton).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens Ask this book as a sheet, and leaves the docked panel closed', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    await mountReader()
    await phoneAskButton.click()
    await expect.element(askSheet).toBeVisible()
    await expect.element(askSheet.getByRole('heading', { name: 'Ask this book' })).toBeVisible()
    expect(askState()).toBe('closed')
  })
})

describe('Reader at desktop width', () => {
  it('docks Ask this book beside the page instead of opening a sheet', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader()
    expect(askState()).toBe('closed')
    await desktopAskButton.click()
    await expect.element(desktopAskButton).toHaveAttribute('aria-expanded', 'true')
    await vi.waitFor(() => expect(askState()).toBe('open'))
    await expect.element(askPanel).toBeInTheDocument()
    await expect.element(askSheet).not.toBeInTheDocument()
  })

  it('closes the docked panel when Ask is pressed again', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader()
    await desktopAskButton.click()
    await vi.waitFor(() => expect(askState()).toBe('open'))
    await desktopAskButton.click()
    await expect.element(desktopAskButton).toHaveAttribute('aria-expanded', 'false')
    expect(askState()).toBe('closed')
  })
})

describe('Reader when the window crosses 900px', () => {
  it('closes the Contents drawer when a phone-width window widens to desktop, where the contents are docked', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    await mountReader()
    await phoneContentsButton.click()
    await expect.element(contentsDrawer).toBeVisible()
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await expect.element(contentsDrawer).not.toBeInTheDocument()
    await expect.element(page.getByRole('complementary', { name: 'Book contents panel' })).toBeInTheDocument()
  })

  it('closes the Ask sheet when a phone-width window widens to desktop', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    await mountReader()
    await phoneAskButton.click()
    await expect.element(askSheet).toBeVisible()
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await expect.element(askSheet).not.toBeInTheDocument()
  })
})
