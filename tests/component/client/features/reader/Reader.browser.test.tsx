import { useRouterState } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ToastProvider } from '~/client/components/Toast'
import { PlayerProvider } from '~/client/features/player/PlayerProvider'
import { DEFAULT_PREFS, PREFS_AT_KEY, PREFS_KEY, type ReaderPrefs } from '~/client/features/reader/prefs'
import { Reader } from '~/client/features/reader/Reader'
import type { ReaderPage } from '~/server/books/book'
import { readerParams } from '~/shared/content/position'
import { buildReaderView, type ReaderView } from '~/shared/content/reader-view'
import type { BookContent, ChapterBook, PagedBook } from '~/shared/content/schema'
import { chapterFixture, metaFor } from '../../../../fixtures/books'
import { fixtureCatalog } from '../../../../fixtures/catalog'
import { mountAt } from '../../../../support/client/router'

/**
 * The Reader's hooks load highlights, bookmarks, voices and the reading place from server functions, which import
 * TanStack Start. A signed-out reader calls none of them but `getReaderPage`, which the scroll layout uses to load
 * the pages around the one it opened on, and which each test answers from the book it mounts.
 */
const getReaderPage = vi.hoisted(() =>
  vi.fn<(options: { data: { book: string; part: string; n?: string } }) => Promise<ReaderPage>>(),
)
vi.mock('~/server/functions', () => ({ getReaderPage, getSpeechChapter: vi.fn() }))
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
const SIZES = [
  ['phone', PHONE],
  ['desktop', DESKTOP],
] as const

/** Opening the docked Ask panel is saved with the reader's settings, so each test starts from the defaults. */
beforeEach(() => {
  localStorage.removeItem(PREFS_KEY)
  localStorage.removeItem(PREFS_AT_KEY)
})

/** Thirty paragraphs a page, so a page is taller than the window and the scroll layout has somewhere to scroll. */
const paragraphs = (label: string) =>
  Array.from({ length: 30 }, (_, i) => `<p>${label}, paragraph ${i + 1}.</p>`).join('')

const PICTURE =
  '<figure><a href="/images/essays/concord.svg"><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2230%22/%3E" alt="A map of Concord"></a><figcaption>Concord in 1840</figcaption></figure>'

/** The essays again, with pages long enough to scroll through and a picture on the last one. */
const longEssays: ChapterBook = {
  kind: 'chapter',
  slug: 'essays',
  chapters: [
    {
      id: 'ch_1',
      slug: 'history',
      title: 'History',
      pages: [paragraphs('History page 1'), paragraphs('History page 2'), paragraphs('History page 3')],
    },
    {
      id: 'ch_2',
      slug: 'self-reliance',
      title: 'Self-Reliance',
      pages: [`${paragraphs('Self-Reliance page 1')}${PICTURE}`],
    },
  ],
}

const text = (t: string) => ({ type: 'text' as const, text: t })

/** A printed book whose first page has every kind of block and inline the paged layout draws. */
const confessions: PagedBook = {
  kind: 'paged',
  slug: 'confessions',
  startPage: 7,
  endPage: 8,
  chapters: [{ id: 'ch_1', title: 'Introduction', startPage: 7, endPage: 8, children: [] }],
  pages: [
    {
      pageNumber: 7,
      blocks: [
        { id: 'b1', type: 'heading', alignment: 'center', depth: 2, content: [text('On Seeking')] },
        { id: 'b2', type: 'heading', alignment: 'justify', depth: 3, content: [text('The First Doubt')] },
        {
          id: 'b3',
          type: 'paragraph',
          alignment: 'justify',
          content: [
            text('The seeker turned to '),
            { type: 'text', text: 'kalam', gloss: 'Scholastic theology', italic: true },
            text(' and to '),
            { type: 'text', text: 'falsafa', gloss: 'Philosophy', bold: true },
            text(', and found neither enough.'),
            { type: 'footnoteRef', refId: 'fn1', text: '1' },
          ],
        },
        { id: 'b4', type: 'paragraph', alignment: 'center', content: [{ type: 'arabic', text: 'بسم الله' }] },
      ],
      footnotes: [{ id: 'fn1', content: [text('Kalam is the study of belief through reason.')] }],
    },
    {
      pageNumber: 8,
      blocks: [{ id: 'b5', type: 'paragraph', alignment: 'justify', content: [text('Page eight.')] }],
      footnotes: [],
    },
  ],
}

function viewAt(content: BookContent, href: string): ReaderView | null {
  const params = readerParams(href)
  if (!params) return null
  return buildReaderView({ meta: metaFor(content.slug), catalog: fixtureCatalog }, content, params.part, params.n)
}

/** The reader route in small: the page at the router's address, so turning a page shows the next one. */
function RoutedReader({ content, offline }: { content: BookContent; offline: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const view = viewAt(content, pathname)
  if (!view) return <p>No such page</p>
  return <Reader view={view} signedIn={false} offline={offline} />
}

/** Answers the scroll layout's page loads from `content`, as the server would. */
function serve(content: BookContent) {
  getReaderPage.mockImplementation(async ({ data }) => {
    const view = viewAt(content, `/read/${data.book}/${data.part}${data.n ? `/${data.n}` : ''}`)
    if (!view) throw new Error('Not found')
    return { view, cover: metaFor(content.slug).cover, audio: null, offlineVersion: '' } satisfies ReaderPage
  })
}

/** Saves the reader's settings as the reader would have left them, before the Reader reads them on mount. */
function savePrefs(patch: Partial<ReaderPrefs>) {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...DEFAULT_PREFS, ...patch }))
}

async function mountReader({
  at = '/read/essays/history',
  content = chapterFixture,
  offline = false,
}: {
  at?: string
  content?: BookContent
  offline?: boolean
} = {}) {
  serve(content)
  const router = await mountAt(
    at,
    <ToastProvider>
      <PlayerProvider>
        <RoutedReader content={content} offline={offline} />
      </PlayerProvider>
    </ToastProvider>,
  )
  await expect.element(page.getByRole('navigation', { name: 'Page navigation' })).toBeInTheDocument()
  return router
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

const bottomBar = page.getByRole('navigation', { name: 'Page navigation' })
const nextLink = bottomBar.getByRole('link', { name: 'Next page' })
const previousLink = bottomBar.getByRole('link', { name: 'Previous page' })
const pageLabel = page.getByTestId('reader-page-label')
const settingsDialog = page.getByRole('dialog', { name: 'Reading settings' })

/**
 * The phone bar's Settings button comes first on the page and the desktop's floating one last; both have the same
 * name, and CSS, which these tests don't load, shows only one at each width.
 */
const settingsButton = (size: 'phone' | 'desktop') => {
  const buttons = page.getByRole('button', { name: 'Settings', exact: true })
  return size === 'phone' ? buttons.first() : buttons.last()
}

async function chooseLayout(size: 'phone' | 'desktop', layout: 'Pages' | 'Scroll') {
  await settingsButton(size).click()
  const radio = settingsDialog.getByRole('radiogroup', { name: 'Reading mode' }).getByRole('radio', { name: layout })
  await radio.click()
  await expect.element(radio).toBeChecked()
  await userEvent.keyboard('{Escape}')
  await expect.element(settingsDialog).not.toBeInTheDocument()
}

/**
 * The app's CSS keeps the reader's bars on screen as the page scrolls, shows only the bar for the window's width, and
 * fits the settings to the window, and these tests don't load it. Without these stand-ins for those rules, a bar
 * scrolls away with the page, the other width's bar covers it, and the settings run past the bottom of a phone's
 * window, so pressing Settings scrolls the window, which moves the reader's place in the scroll layout.
 */
function keepBarsOnScreen() {
  const style = document.createElement('style')
  style.textContent = `
    .sticky { position: sticky; top: 0; }
    @media (width < 900px) { .max-\\[899px\\]\\:hidden { display: none; } }
    @media (width >= 900px) { .min-\\[900px\\]\\:hidden { display: none; } }
    [data-testid="reader-settings-popover"] { max-height: var(--available-height); overflow-y: auto; }
  `
  document.head.append(style)
  onTestFinished(() => style.remove())
}

/** The words of a page are plain paragraphs, with no role or name of their own, so they're found by their text. */
const words = (t: string) => page.getByText(t, { exact: true })

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

  it('turns to the next page when the reader swipes left, and back when they swipe right', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    await mountReader()
    await expect.element(words('h1')).toBeVisible()
    swipe(-120)
    await expect.element(words('h2')).toBeVisible()
    swipe(120)
    await expect.element(words('h1')).toBeVisible()
  })

  it('leaves the page where it is for a short or mostly upright swipe', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    const router = await mountReader()
    await expect.element(words('h1')).toBeVisible()
    swipe(-30)
    swipe(-80, 200)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(router.state.location.pathname).toBe('/read/essays/history')
  })
})

/** A finger drawn `dx` pixels across the page, and `dy` down it, in one quick stroke. */
function swipe(dx: number, dy = 0) {
  const article = document.querySelector('[data-testid="reader-page"]')
  if (!article) throw new Error('No page on screen')
  const touch = (x: number, y: number) => new Touch({ identifier: 1, target: article, clientX: x, clientY: y })
  article.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(200, 300)] }))
  article.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [touch(200 + dx, 300 + dy)] }))
}

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

  it('turns pages with the arrows either side of the page', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader()
    await expect.element(page.getByRole('button', { name: 'Start of book' })).toBeDisabled()
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect.element(words('h2')).toBeVisible()
    await page.getByRole('button', { name: 'Previous page' }).click()
    await expect.element(words('h1')).toBeVisible()
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

describe.each(SIZES)('Reader in the pages layout at %s width', (size, { width, height }) => {
  beforeEach(async () => {
    await page.viewport(width, height)
  })

  it('shows the chapter’s title and its first page', async () => {
    await mountReader()
    await expect.element(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
    await expect.element(words('h1')).toBeVisible()
    await expect.element(pageLabel).toHaveTextContent('History. Chapter 1 · Page 1 of 3')
    await expect
      .element(page.getByRole('progressbar', { name: 'Progress in book' }))
      .toHaveAttribute('aria-valuenow', '1')
  })

  it('turns to the next and the previous page with the buttons below the page', async () => {
    const router = await mountReader()
    await nextLink.click()
    await expect.element(words('h2')).toBeVisible()
    await expect.element(words('h1')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/read/essays/history/2')
    await expect.element(pageLabel).toHaveTextContent('History. Chapter 1 · Page 2 of 3')
    await previousLink.click()
    await expect.element(words('h1')).toBeVisible()
    expect(router.state.location.pathname).toBe('/read/essays/history')
  })

  it('turns pages with the right and left arrow keys', async () => {
    const router = await mountReader()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(words('h2')).toBeVisible()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(words('h3')).toBeVisible()
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(words('h2')).toBeVisible()
    expect(router.state.location.pathname).toBe('/read/essays/history/2')
  })

  it('leaves the page where it is for an arrow key with a modifier, or while the settings are open', async () => {
    const router = await mountReader()
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await settingsButton(size).click()
    await expect.element(settingsDialog).toBeVisible()
    await userEvent.keyboard('{ArrowRight}')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(router.state.location.pathname).toBe('/read/essays/history')
  })

  it('jumps to a page from the dots below the page', async () => {
    await mountReader()
    const dot = page.getByRole('link', { name: 'Page 3', exact: true })
    /** A dot is drawn by CSS, which these tests don't load, so it has no size to click and is clicked in script. */
    ;(dot.element() as HTMLAnchorElement).click()
    await expect.element(words('h3')).toBeVisible()
    await expect.element(dot).toHaveAttribute('aria-current', 'page')
  })

  it('names the next chapter on a chapter’s last page, and turns to it', async () => {
    await mountReader({ at: '/read/essays/history/3' })
    const toChapter = bottomBar.getByRole('link', { name: 'Self-Reliance' })
    await expect.element(toChapter).toBeVisible()
    await toChapter.click()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Self-Reliance' })).toBeVisible()
    await expect.element(words('s1')).toBeVisible()
    await expect.element(bottomBar.getByRole('link', { name: 'History' })).toBeVisible()
  })

  it('ends at the last page, where there’s no page to turn to', async () => {
    const router = await mountReader({ at: '/read/essays/self-reliance' })
    /** With nowhere to go, the bar's last place is plain text marked disabled, not a link, so it has no role. */
    const lastPlace = bottomBar.getByTestId('reader-next-page')
    await expect.element(lastPlace).toHaveTextContent('End of book')
    await expect.element(lastPlace).toHaveAttribute('aria-disabled', 'true')
    await expect.element(bottomBar.getByRole('link', { name: /next/i })).not.toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: 'End of book' })).toBeDisabled()
    await userEvent.keyboard('{ArrowRight}')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(router.state.location.pathname).toBe('/read/essays/self-reliance')
  })

  it('switches to the scroll layout on the page the reader is on', async () => {
    const router = await mountReader({ at: '/read/essays/history/2' })
    await chooseLayout(size, 'Scroll')
    await expect.element(page.getByRole('article', { name: 'Page 2 of 3' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Show earlier pages' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/read/essays/history/2')
  })
})

describe.each(SIZES)('Reader in the scroll layout at %s width', (size, { width, height }) => {
  beforeEach(async () => {
    await page.viewport(width, height)
    savePrefs({ layout: 'scroll' })
    keepBarsOnScreen()
  })

  const article = (name: string) => page.getByRole('article', { name })
  /**
   * The column loads the next page once the mark below its last page comes within one and a half windows of the
   * screen. Inside the test's iframe that look-ahead stops at the iframe's bottom edge, so here the next page loads only
   * when the reader scrolls to the end of the ones they have.
   */
  const scrollDownTo = async (name: string) => {
    await expect
      .poll(
        () => {
          window.scrollTo({ top: document.documentElement.scrollHeight })
          return article(name).query() !== null
        },
        { timeout: 5000 },
      )
      .toBe(true)
  }
  const scrollToTop = (name: string) => article(name).element().scrollIntoView()
  const at = (router: Awaited<ReturnType<typeof mountReader>>) => router.state.location.pathname

  it('shows the page it opened on, and loads the pages after it as the reader nears them', async () => {
    await mountReader({ content: longEssays })
    await expect.element(article('Page 1 of 3')).toBeVisible()
    await expect.element(words('History page 1, paragraph 1.')).toBeVisible()
    await expect.element(article('Page 2 of 3')).not.toBeInTheDocument()
    await scrollDownTo('Page 2 of 3')
    await scrollDownTo('Page 3 of 3')
    await expect.element(page.getByRole('link', { name: /^Next chapter\s*Self-Reliance$/ })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Show earlier pages' })).not.toBeInTheDocument()
  })

  it('follows the page the reader scrolls to in the address and the bar below', async () => {
    const router = await mountReader({ content: longEssays })
    await scrollDownTo('Page 2 of 3')
    scrollToTop('Page 2 of 3')
    await expect.poll(() => at(router), { timeout: 3000 }).toBe('/read/essays/history/2')
    await expect.element(pageLabel).toHaveTextContent('History. Chapter 1 · Page 2 of 3')
    await expect.element(article('Page 1 of 3')).toBeInTheDocument()
  })

  it('scrolls to the next page with the arrow key, without leaving the column', async () => {
    const router = await mountReader({ content: longEssays })
    await expect.element(article('Page 1 of 3')).toBeVisible()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => at(router), { timeout: 3000 }).toBe('/read/essays/history/2')
    await expect.element(article('Page 1 of 3')).toBeInTheDocument()
    expect(article('Page 2 of 3').element().getBoundingClientRect().top).toBeLessThan(height * 0.3)
  })

  it('loads and scrolls to a page further on that a dot below the page names', async () => {
    const router = await mountReader({ content: longEssays })
    await expect.element(article('Page 1 of 3')).toBeVisible()
    /** A dot is drawn by CSS, which these tests don't load, so it has no size to click and is clicked in script. */
    ;(page.getByRole('link', { name: 'Page 3', exact: true }).element() as HTMLAnchorElement).click()
    await expect.element(article('Page 3 of 3')).toBeInTheDocument()
    await expect.poll(() => at(router), { timeout: 3000 }).toBe('/read/essays/history/3')
  })

  it('shows the pages before the one it opened on when the reader asks for them', async () => {
    await mountReader({ at: '/read/essays/history/3', content: longEssays })
    const earlier = page.getByRole('button', { name: 'Show earlier pages' })
    await earlier.click()
    await expect.element(article('Page 2 of 3')).toBeInTheDocument()
    await earlier.click()
    await expect.element(article('Page 1 of 3')).toBeInTheDocument()
    await expect.element(earlier).not.toBeInTheDocument()
    await expect.element(article('Page 3 of 3')).toBeInTheDocument()
  })

  it('says so when an earlier page can’t be loaded, and lets the reader ask again', async () => {
    await mountReader({ at: '/read/essays/history/2', content: longEssays })
    getReaderPage.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const earlier = page.getByRole('button', { name: 'Show earlier pages' })
    await earlier.click()
    await expect.element(page.getByText('Couldn’t load the earlier page')).toBeVisible()
    await earlier.click()
    await expect.element(article('Page 1 of 3')).toBeInTheDocument()
  })

  it('says so while the next page loads and when it fails, and loads it on Retry', async () => {
    let fail: (error: Error) => void = () => {}
    serve(longEssays)
    getReaderPage.mockImplementationOnce(
      () =>
        new Promise<ReaderPage>((_, reject) => {
          fail = reject
        }),
    )
    const router = await mountAt(
      '/read/essays/history',
      <ToastProvider>
        <PlayerProvider>
          <RoutedReader content={longEssays} offline={false} />
        </PlayerProvider>
      </ToastProvider>,
    )
    await expect.element(article('Page 1 of 3')).toBeVisible()
    window.scrollTo({ top: document.documentElement.scrollHeight })
    const status = page.getByRole('status').filter({ hasText: /next page/ })
    await expect.element(status).toHaveTextContent('Loading the next page…')
    fail(new TypeError('Failed to fetch'))
    const retry = status.getByRole('button', { name: 'Retry' })
    await expect.element(retry).toBeVisible()
    expect(status.element().textContent).toBe('Couldn’t load the next page.Retry')
    await retry.click()
    await expect.element(article('Page 2 of 3')).toBeInTheDocument()
    await expect.element(status).not.toBeInTheDocument()
    expect(at(router)).toBe('/read/essays/history')
  })

  it('offers the next chapter below a chapter’s last page, and starts the column again there', async () => {
    const router = await mountReader({ at: '/read/essays/history/3', content: longEssays })
    const toChapter = page.getByRole('link', { name: /^Next chapter\s*Self-Reliance$/ })
    await toChapter.click()
    await expect.poll(() => at(router)).toBe('/read/essays/self-reliance')
    await expect.element(article('Page 1 of 1')).toBeInTheDocument()
    await expect.element(article('Page 3 of 3')).not.toBeInTheDocument()
    await expect.element(page.getByRole('heading', { level: 1, name: 'Self-Reliance' })).toBeInTheDocument()
  })

  it('ends the book with a way back to the book’s page', async () => {
    await mountReader({ at: '/read/essays/self-reliance', content: longEssays })
    const end = page.getByRole('link', { name: /^End of book\s*Essays$/ })
    await expect.element(end).toHaveAttribute('href', '/library/emerson/essays')
  })

  it('switches to the pages layout on the page the reader has scrolled to', async () => {
    const router = await mountReader({ content: longEssays })
    await scrollDownTo('Page 2 of 3')
    scrollToTop('Page 2 of 3')
    await chooseLayout(size, 'Pages')
    await expect.element(words('History page 2, paragraph 1.')).toBeVisible()
    await expect.element(words('History page 1, paragraph 1.')).not.toBeInTheDocument()
    await expect.element(page.getByRole('article', { name: /^Page/ })).not.toBeInTheDocument()
    expect(at(router)).toBe('/read/essays/history/2')
  })
})

describe('Reader’s pictures', () => {
  it.each(SIZES)('opens a picture full size at %s width, and closes it again', async (_, { width, height }) => {
    await page.viewport(width, height)
    await mountReader({ at: '/read/essays/self-reliance', content: longEssays })
    const link = page.getByRole('link', { name: 'A map of Concord' })
    await link.click()
    const viewer = page.getByRole('dialog', { name: 'Concord in 1840' })
    await expect.element(viewer).toBeVisible()
    await expect.element(viewer.getByRole('img', { name: 'A map of Concord' })).toBeVisible()
    await viewer.getByRole('button', { name: 'Close picture' }).click()
    await expect.element(viewer).not.toBeInTheDocument()
    await expect.element(link).toHaveFocus()
  })

  it('closes the picture with Escape, and leaves the arrow keys to it while it’s open', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    const router = await mountReader({ at: '/read/essays/self-reliance', content: longEssays })
    await page.getByRole('link', { name: 'A map of Concord' }).click()
    const viewer = page.getByRole('dialog', { name: 'Concord in 1840' })
    await expect.element(viewer).toBeVisible()
    await userEvent.keyboard('{ArrowLeft}')
    await userEvent.keyboard('{Escape}')
    await expect.element(viewer).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/read/essays/self-reliance')
  })
})

describe('Reader’s printed pages', () => {
  const at = '/read/confessions/7'

  it('draws the page’s headings, emphasis, Arabic and page number', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader({ at, content: confessions })
    await expect.element(page.getByRole('heading', { level: 2, name: 'On Seeking' })).toBeVisible()
    await expect.element(page.getByRole('heading', { level: 3, name: 'The First Doubt' })).toBeVisible()
    const arabic = page.getByText('بسم الله')
    await expect.element(arabic).toHaveAttribute('lang', 'ar')
    await expect.element(arabic).toHaveAttribute('dir', 'rtl')
    await expect.element(page.getByTestId('reader-page-number')).toHaveTextContent('Page 7')
    expect(page.getByRole('button', { name: 'kalam' }).element().querySelector('em')).not.toBeNull()
    expect(page.getByRole('button', { name: 'falsafa' }).element().querySelector('strong')).not.toBeNull()
  })

  it('shows a word’s meaning when it’s pressed, and hides it when it’s pressed again', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader({ at, content: confessions })
    const kalam = page.getByRole('button', { name: 'kalam' })
    await kalam.click()
    const meaning = page.getByRole('tooltip')
    await expect.element(meaning).toHaveTextContent('Scholastic theology')
    await expect.element(kalam).toHaveAttribute('aria-expanded', 'true')
    await expect.element(kalam).toHaveAccessibleDescription('Scholastic theology')
    await kalam.click()
    await expect.element(meaning).not.toBeInTheDocument()
    await expect.element(kalam).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves the meaning to the word pressed next', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader({ at, content: confessions })
    await page.getByRole('button', { name: 'kalam' }).click()
    await page.getByRole('button', { name: 'falsafa' }).click()
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Philosophy')
    await expect.element(page.getByRole('button', { name: 'kalam' })).toHaveAttribute('aria-expanded', 'false')
  })

  it.each([
    ['Escape is pressed', () => userEvent.keyboard('{Escape}')],
    ['the reader presses elsewhere', () => page.getByRole('heading', { name: 'On Seeking' }).click()],
    ['the window is resized', () => page.viewport(DESKTOP.width - 100, DESKTOP.height)],
  ])('hides a word’s meaning when %s', async (_, act) => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader({ at, content: confessions })
    await page.getByRole('button', { name: 'kalam' }).click()
    await expect.element(page.getByRole('tooltip')).toBeVisible()
    await act()
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument()
  })

  it('opens a footnote from its mark in the text, and from the list below the page', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    await mountReader({ at, content: confessions })
    const footnotes = page.getByRole('complementary', { name: 'Footnotes' })
    await expect.element(footnotes).toBeVisible()
    await page.getByRole('button', { name: 'Footnote 1' }).click()
    const sheet = page.getByRole('dialog', { name: 'Footnote' })
    await expect.element(sheet).toBeVisible()
    await expect.element(sheet.getByText('Kalam is the study of belief through reason.')).toBeVisible()
    await expect.element(sheet.getByRole('button', { name: 'Close' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(sheet).not.toBeInTheDocument()
    await footnotes.getByRole('button', { name: /Kalam is the study/ }).click()
    await expect.element(sheet).toBeVisible()
  })

  it('hides the meaning shown on a page when the reader turns to the next', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader({ at, content: confessions })
    await page.getByRole('button', { name: 'kalam' }).click()
    await expect.element(page.getByRole('tooltip')).toBeVisible()
    await nextLink.click()
    await expect.element(words('Page eight.')).toBeVisible()
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('Reader’s highlights and bookmarks tabs for a reader who isn’t signed in', () => {
  it('asks the reader to sign in to keep highlights, and comes back to this page after', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader({ at: '/read/essays/history/2' })
    const panel = page.getByRole('complementary', { name: 'Book contents panel' })
    await panel.getByRole('tab', { name: /Highlights/ }).click()
    await expect.element(panel.getByText('Sign in to highlight passages and keep notes on this book.')).toBeVisible()
    const signIn = panel.getByRole('link', { name: 'Sign in' })
    await expect.element(signIn).toHaveAttribute('href', '/login?next=%2Fread%2Fessays%2Fhistory%2F2')
  })

  it('says highlights and bookmarks come back with the connection when the reader is offline', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader({ offline: true })
    const panel = page.getByRole('complementary', { name: 'Book contents panel' })
    await panel.getByRole('tab', { name: /Highlights/ }).click()
    await expect.element(panel.getByText('Highlights show here when you’re back online.')).toBeVisible()
    await panel.getByRole('tab', { name: /Bookmarks/ }).click()
    await expect.element(panel.getByText('Bookmarks show here when you’re back online.')).toBeVisible()
    await expect.element(page.getByText('Offline', { exact: true }).first()).toBeVisible()
  })
})

/** Selects `phrase` on the page, as a reader would by dragging over it. */
function select(phrase: string) {
  const root = document.querySelector('[data-highlight-root]')
  if (!root) throw new Error('No page on screen')
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const start = node.textContent?.indexOf(phrase) ?? -1
    if (start < 0) continue
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + phrase.length)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(range)
    return
  }
  throw new Error(`“${phrase}” isn’t on the page`)
}

const passage = 'History page 1, paragraph 3.'

/** Signed out, Ask asks the reader to sign in rather than taking the passage, so these check where Ask opens. */
describe('Reader’s actions on a selected passage, signed out', () => {
  it('opens Ask as a sheet at phone width', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    await mountReader({ content: longEssays })
    select(passage)
    await page.getByRole('button', { name: 'Ask about this', exact: true }).click()
    await expect.element(askSheet).toBeVisible()
    expect(askState()).toBe('closed')
  })

  it('docks Ask beside the page for Explain at desktop width', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader({ content: longEssays })
    select(passage)
    await page.getByRole('button', { name: 'Explain', exact: true }).click()
    await vi.waitFor(() => expect(askState()).toBe('open'))
    await expect.element(askPanel).toBeInTheDocument()
    await expect.element(askSheet).not.toBeInTheDocument()
  })

  it('keeps the docked Ask open when it’s open already', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    savePrefs({ askOpen: true })
    await mountReader({ content: longEssays })
    await vi.waitFor(() => expect(askState()).toBe('open'))
    select(passage)
    await page.getByRole('button', { name: 'Ask about this', exact: true }).click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(askState()).toBe('open')
  })

  it.each(SIZES)('opens the highlights tab to sign in on Highlight at %s width', async (size, { width, height }) => {
    await page.viewport(width, height)
    await mountReader({ content: longEssays })
    select(passage)
    await page.getByRole('button', { name: 'Highlight', exact: true }).click()
    const where = size === 'phone' ? contentsDrawer : page.getByRole('complementary', { name: 'Book contents panel' })
    await expect.element(where.getByRole('tab', { name: /Highlights/ })).toHaveAttribute('aria-selected', 'true')
    await expect.element(where.getByRole('link', { name: 'Sign in' })).toBeVisible()
  })
})

describe('Reader’s bookmark ribbon for a reader who isn’t signed in', () => {
  it('opens the bookmarks tab in the Contents drawer at phone width', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    await mountReader()
    await page.getByRole('button', { name: 'Bookmark this page' }).click()
    await expect.element(contentsDrawer).toBeVisible()
    await expect
      .element(contentsDrawer.getByRole('tab', { name: /Bookmarks/ }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('brings back a hidden contents panel on its bookmarks tab at desktop width', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader()
    const sidebar = () => document.documentElement.getAttribute('data-reader-sidebar')
    await page.getByRole('button', { name: 'Hide contents panel' }).click()
    await vi.waitFor(() => expect(sidebar()).toBe('hidden'))
    await page.getByRole('button', { name: 'Bookmark this page' }).click()
    await vi.waitFor(() => expect(sidebar()).toBe('shown'))
    const panel = page.getByRole('complementary', { name: 'Book contents panel' })
    await expect.element(panel.getByRole('tab', { name: /Bookmarks/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('brings back a hidden contents panel on its contents tab from the Contents button at desktop width', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader()
    const sidebar = () => document.documentElement.getAttribute('data-reader-sidebar')
    const panel = page.getByRole('complementary', { name: 'Book contents panel' })
    await panel.getByRole('tab', { name: /Bookmarks/ }).click()
    await page.getByRole('button', { name: 'Hide contents panel' }).click()
    await vi.waitFor(() => expect(sidebar()).toBe('hidden'))
    /** The desktop's Contents button has the same name as the phone bar's, which CSS hides at this width. */
    const showContents = page.getByTestId('reader-show-contents')
    await expect.element(showContents).toHaveRole('button')
    await expect.element(showContents).toHaveAccessibleName('Contents')
    await showContents.click()
    await vi.waitFor(() => expect(sidebar()).toBe('shown'))
    await expect.element(panel.getByRole('tab', { name: 'Contents' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Reader’s Share button', () => {
  /** Puts `share` on the page's `navigator`, as a phone's browser has it, or takes it away, until the test ends. */
  function browserShare(share: ((data: ShareData) => Promise<void>) | undefined) {
    const own = Object.getOwnPropertyDescriptor(navigator, 'share')
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true })
    onTestFinished(() => {
      if (own) Object.defineProperty(navigator, 'share', own)
      else Reflect.deleteProperty(navigator, 'share')
    })
  }
  const shareButton = (size: 'phone' | 'desktop') => {
    /** The phone bar's Share comes first, the desktop bar's last; CSS shows one of them at each width. */
    const buttons = page.getByRole('button', { name: 'Share', exact: true })
    return size === 'phone' ? buttons.first() : buttons.last()
  }

  it('hands the page’s address to the phone’s share sheet', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    const share = vi.fn(async (_data: ShareData) => {})
    browserShare(share)
    await mountReader({ at: '/read/essays/history/2' })
    await shareButton('phone').click()
    expect(share).toHaveBeenCalledExactlyOnceWith({
      title: 'Essays · History',
      url: `${window.location.origin}/read/essays/history/2`,
    })
  })

  it('says nothing when the reader closes the share sheet', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    browserShare(async () => {
      throw new DOMException('Share canceled', 'AbortError')
    })
    const copy = vi.spyOn(navigator.clipboard, 'writeText')
    await mountReader()
    await shareButton('phone').click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(copy).not.toHaveBeenCalled()
    await expect.element(page.getByRole('status').filter({ hasText: 'Link copied' })).not.toBeInTheDocument()
  })

  it('copies the address where there’s no share sheet, and says so', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    browserShare(undefined)
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await mountReader()
    await shareButton('desktop').click()
    await expect.element(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible()
    expect(copy).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/read/essays/history`)
  })

  it('shows the address when it can’t be copied either', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    browserShare(undefined)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    await mountReader()
    await shareButton('desktop').click()
    await expect
      .element(page.getByRole('status').filter({ hasText: `${window.location.origin}/read/essays/history` }))
      .toBeVisible()
  })
})

describe('Reader’s fullscreen', () => {
  beforeEach(() => {
    sessionStorage.removeItem('reader-fullscreen')
  })
  const fullscreen = () => document.documentElement.getAttribute('data-reader-fullscreen')
  const exit = page.getByRole('button', { name: 'Exit fullscreen' })

  it('hides the menus when the reader goes fullscreen, and brings them back on Exit fullscreen', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await mountReader()
    /** The phone bar's button comes first and the desktop's last, with the same name; CSS shows one at each width. */
    await page.getByRole('button', { name: 'Read fullscreen' }).last().click()
    await expect.element(exit).toBeVisible()
    expect(fullscreen()).toBe('on')
    await exit.click()
    await expect.element(exit).not.toBeInTheDocument()
    expect(fullscreen()).toBeNull()
  })

  it('stays fullscreen on the next page the reader opens in this tab', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    sessionStorage.setItem('reader-fullscreen', 'on')
    await mountReader()
    await expect.element(exit).toBeVisible()
    expect(fullscreen()).toBe('on')
  })

  it('brings the menus back when the browser leaves fullscreen on its own, as on Escape', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    sessionStorage.setItem('reader-fullscreen', 'on')
    await mountReader()
    await expect.element(exit).toBeVisible()
    document.dispatchEvent(new Event('fullscreenchange'))
    await expect.element(exit).not.toBeInTheDocument()
    expect(sessionStorage.getItem('reader-fullscreen')).toBeNull()
  })
})
