import { readFileSync } from 'node:fs'
import type { Browser, Locator, Page, TestInfo } from '@playwright/test'
import type { BookContent } from '../../../src/shared/content/schema.ts'
import { utterances } from '../../../src/shared/read-aloud/sentences.ts'
import { speechChapter } from '../../../src/shared/read-aloud/speech-text.ts'
import type { SyncBatch } from '../../../src/shared/sync/sync.ts'
import { AudioPlayer, press, ReadAloud, ReaderPage } from '../pages'
import { createUser, signInOverHttp, type TestUser } from '../support/accounts'
import { fakeSpeech, hang, lastSpoken } from '../support/fake-speech'
import { expect, expectAccessible, expectNoSideways, hydrated, test } from '../support/fixtures'
import { importViaApi } from '../support/imports'

const PAGE = '/read/pride-and-prejudice/chapter-6/2'
const BOOK_PAGE = '/library/jane-austen/pride-and-prejudice'
const PROPHET = '/library/poetry-of-the-spirit/the-prophet'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const pride = JSON.parse(readFileSync('tests/e2e/content/books/pride-and-prejudice.json', 'utf8')) as BookContent
const chapter6page2 = speechChapter(pride, 5)?.pages[1]
if (!chapter6page2) throw new Error('fixture page missing')
const sentences = utterances(chapter6page2, 'en')

const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true })
const bar = (page: Page) => page.getByRole('status').filter({ hasText: /^You were on/ })
const local = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key)

const sentBy = new WeakMap<Page, { body: SyncBatch; status: number }[]>()
function track(page: Page) {
  const seen: { body: SyncBatch; status: number }[] = []
  sentBy.set(page, seen)
  page.on('response', (r) => {
    if (r.url().endsWith('/account/sync') && r.request().method() === 'POST')
      seen.push({ body: r.request().postDataJSON() as SyncBatch, status: r.status() })
  })
  return seen
}

async function sendUntil(page: Page, wanted: (body: SyncBatch) => boolean) {
  const seen = sentBy.get(page) ?? track(page)
  await expect
    .poll(
      async () => {
        if (seen.some((s) => s.status === 200 && wanted(s.body))) return true
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
        return false
      },
      { timeout: 20_000, intervals: [100, 250, 500] },
    )
    .toBe(true)
}

const readsOn =
  (book: string, chapter: string, page = 1) =>
  (body: SyncBatch) =>
    body.reading?.some(
      (r) => r.book === book && 'chapter' in r.position && r.position.chapter === chapter && r.position.page === page,
    ) ?? false

async function otherDevice(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
    userAgent: IPHONE,
  })
  const page = await context.newPage()
  track(page)
  return page
}

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await hydrated(page)
}

async function signedIn(page: Page, user: TestUser, at: string) {
  await signInOverHttp(page.request, user)
  await open(page, at)
  await expect.poll(() => local(page, 'sync-account')).toBe(user.username)
}

const hide = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

const comeBack = (page: Page, ms: number) =>
  page.evaluate((shift) => {
    const real = Date.now.bind(Date)
    Date.now = () => real() + shift
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, ms)

test.beforeEach(async ({ page }) => {
  track(page)
})

test.describe('Sync across devices: reading places', () => {
  test('a place read on one device is Continue reading on the other, and offered there: Go there, Dismiss, turning the page', async ({
    page,
    request,
    browser,
    readerPage,
  }, info) => {
    const user = await createUser(request)
    await signedIn(page, user, PAGE)
    await sendUntil(page, readsOn('pride-and-prejudice', 'chapter-6', 2))

    const b = await otherDevice(browser, info)
    await signedIn(b, user, '/library')
    const card = b.getByRole('region', { name: 'Continue reading' })
    await expect(card).toContainText('Pride and Prejudice')
    await expect(card).toContainText('Chapter 6')
    await expect(card.getByRole('link', { name: /^Resume/ })).toHaveAttribute('href', PAGE)
    await open(b, BOOK_PAGE)
    const resume = b.getByRole('link', { name: 'Continue reading', exact: true })
    await expect(resume).toHaveAttribute('href', PAGE)
    await expect(b.getByText(/^Ch\. 6 · p\. 2 · Start from the beginning$/)).toBeVisible()
    const beginning = b.getByRole('link', { name: 'Start from the beginning' })
    await expect(beginning).toHaveAttribute('href', '/read/pride-and-prejudice/chapter-1')
    await expectAccessible(b)
    await expectNoSideways(b)
    await press(b, beginning)
    await expect(b).toHaveURL('/read/pride-and-prejudice/chapter-1')

    await readerPage.goto('pride-and-prejudice', 'chapter-7')
    await sendUntil(page, readsOn('pride-and-prejudice', 'chapter-7'))
    await open(b, '/read/pride-and-prejudice/chapter-1')
    await expect(bar(b)).toHaveText(/^You were on Ch\. 7 · p\. 1 in .+, just now\.$/)
    expect(await bar(b).evaluate((el) => el.closest('[data-highlight-root]'))).toBeNull()
    await expectAccessible(b)
    await expectNoSideways(b)
    const goThere = b.getByRole('link', { name: 'Go there' })
    if (info.project.name === 'desktop') {
      const beforeText = await goThere.evaluate((el) =>
        Boolean(
          el.compareDocumentPosition(document.querySelector('[data-highlight-root]') as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      )
      expect(beforeText).toBe(true)
      await goThere.focus()
      await b.keyboard.press('Tab')
      await expect(button(b, 'Dismiss')).toBeFocused()
    }
    await press(b, goThere)
    await expect(b).toHaveURL('/read/pride-and-prejudice/chapter-7')
    await expect(bar(b)).toHaveCount(0)

    await readerPage.goto('pride-and-prejudice', 'chapter-8')
    await sendUntil(page, readsOn('pride-and-prejudice', 'chapter-8'))
    await open(b, '/read/pride-and-prejudice/chapter-1')
    await expect(bar(b)).toHaveText(/^You were on Ch\. 8 · p\. 1 in /)
    await press(b, button(b, 'Dismiss'))
    await expect(bar(b)).toHaveCount(0)
    await press(b, b.getByRole('link', { name: 'Next page' }))
    await expect(b).toHaveURL('/read/pride-and-prejudice/chapter-1/2')
    await expect(bar(b)).toHaveCount(0)

    const readerB = new ReaderPage(b)
    await press(b, readerB.settingsButton)
    await press(
      b,
      readerB.settings
        .getByRole('radiogroup', { name: 'Reading mode' })
        .locator('label')
        .filter({ has: b.getByRole('radio', { name: 'Scroll', exact: true }) }),
    )
    await b.keyboard.press('Escape')
    await readerPage.goto('pride-and-prejudice', 'chapter-9')
    await sendUntil(page, readsOn('pride-and-prejudice', 'chapter-9'))
    await open(b, '/read/pride-and-prejudice/chapter-1')
    await expect(b.locator('html')).toHaveAttribute('data-reader-layout', 'scroll')
    await expect(bar(b)).toHaveText(/^You were on Ch\. 9 · p\. 1 in /)
    await press(b, b.getByRole('link', { name: 'Go there' }))
    await expect(b).toHaveURL('/read/pride-and-prejudice/chapter-9')
    await b.context().close()
  })

  test('coming back to a tab left on an older page offers the newer place', async ({
    page,
    request,
    browser,
  }, info) => {
    const user = await createUser(request)
    await signedIn(page, user, PAGE)
    await sendUntil(page, readsOn('pride-and-prejudice', 'chapter-6', 2))
    await hide(page)

    const b = await otherDevice(browser, info)
    await signedIn(b, user, '/read/pride-and-prejudice/chapter-7')
    await sendUntil(b, readsOn('pride-and-prejudice', 'chapter-7'))
    await b.context().close()

    await expect(bar(page)).toHaveCount(0)
    await comeBack(page, 61_000)
    await expect(bar(page)).toHaveText(/^You were on Ch\. 7 · p\. 1 in Safari on iPhone, /)
  })
})

test.describe('Sync across devices: settings and listening', () => {
  test('theme, font, spacing and width follow the reader; size and mode stay with each device', async ({
    page,
    request,
    browser,
    readerPage,
  }, info) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    await press(page, readerPage.settingsButton)
    const panel = readerPage.settings
    await expect(panel).toBeVisible()
    await expect(panel.getByText(/follow you to your other devices/)).toHaveCount(0)
    await page.keyboard.press('Escape')

    const user = await createUser(request)
    await signedIn(page, user, '/read/pride-and-prejudice/chapter-1')
    await press(page, readerPage.settingsButton)
    await expect(
      panel.getByText('Theme, font, line spacing and page width follow you to your other devices.'),
    ).toBeVisible()
    const tile = (group: string, name: string) =>
      panel
        .getByRole('radiogroup', { name: group })
        .locator('label')
        .filter({ has: page.getByRole('radio', { name, exact: true }) })
    await press(page, tile('Theme', 'Sepia'))
    await press(page, tile('Font', 'OpenDyslexic'))
    await press(page, tile('Line spacing', 'Relaxed'))
    await press(page, tile('Page width', 'Wide'))
    await press(page, button(panel, 'Increase font size'))
    await press(page, button(panel, 'Increase font size'))
    await press(page, tile('Reading mode', 'Scroll'))
    await page.keyboard.press('Escape')
    await sendUntil(
      page,
      (b) =>
        b.settings?.values.theme === 'sepia' &&
        b.settings.values.font === 'opendyslexic' &&
        b.settings.values.leading === 'relaxed' &&
        b.settings.values.measure === 'wide',
    )

    const b = await otherDevice(browser, info)
    await signedIn(b, user, '/read/pride-and-prejudice/chapter-1')
    const html = b.locator('html')
    await expect(html).toHaveAttribute('data-reader-theme', 'sepia')
    const style = (name: string) => html.evaluate((el, n) => el.style.getPropertyValue(n), name)
    await expect.poll(() => style('--reader-font')).toContain('OpenDyslexic')
    await expect.poll(() => style('--reader-leading')).toBe('2.15')
    await expect.poll(() => style('--reader-measure')).toBe('780px')
    expect(await style('--reader-font-size')).toBe('19px')
    await expect(html).toHaveAttribute('data-reader-layout', 'pages')

    await hide(b)
    await press(page, readerPage.settingsButton)
    await press(page, tile('Theme', 'Dark'))
    await page.keyboard.press('Escape')
    await sendUntil(page, (body) => body.settings?.values.theme === 'dark')
    await comeBack(b, 61_000)
    await expect(html).toHaveAttribute('data-reader-theme', 'dark')
    expect(await style('--reader-font-size')).toBe('19px')
    await b.context().close()
  })

  test('an audiobook episode resumes where it stopped on the other device', async ({
    page,
    request,
    browser,
    audioPlayer,
  }, info) => {
    const user = await createUser(request)
    await signedIn(page, user, PROPHET)
    await press(page, button(page, 'Listen'))
    const dock = audioPlayer.dock
    await expect(dock).toContainText('The Coming of the Ship')
    await press(page, audioPlayer.dockButton('Forward 15 seconds'))
    const seconds = async (scope: Locator) => {
      const [mm = '0', ss = '0'] =
        ((await scope.getByText(/\d+:\d\d \/ /).textContent()) ?? '').split(' / ')[0]?.split(':') ?? []
      return Number(mm) * 60 + Number(ss)
    }
    await expect.poll(() => seconds(dock)).toBeGreaterThanOrEqual(14)
    await press(page, audioPlayer.dockButton('Pause'))
    await sendUntil(
      page,
      (b) =>
        b.listening?.some((l) => l.kind === 'episode' && l.episode === 'ep_1' && (l.positionMs ?? 0) >= 14_000) ??
        false,
    )
    const saved = (sentBy.get(page) ?? [])
      .flatMap((s) => s.body.listening ?? [])
      .filter((l) => l.kind === 'episode' && l.episode === 'ep_1')
      .at(-1)
    const savedSeconds = Math.floor(((saved?.kind === 'episode' && saved.positionMs) || 0) / 1000)

    const b = await otherDevice(browser, info)
    await signedIn(b, user, PROPHET)
    await expect.poll(() => local(b, 'listen-pos:the-prophet:ep_1')).not.toBeNull()
    await press(b, button(b, 'Listen'))
    const other = new AudioPlayer(b).dock
    await expect(other).toContainText('The Coming of the Ship')
    await expect.poll(async () => Math.abs((await seconds(other)) - savedSeconds)).toBeLessThanOrEqual(1)
    await b.context().close()
  })

  test('Read aloud resumes at the sentence where it stopped on the other device', async ({
    page,
    request,
    browser,
    readAloud,
  }, info) => {
    const third = sentences[2]
    if (!third) throw new Error('the page has fewer than three sentences')
    await fakeSpeech(page)
    const user = await createUser(request)
    await signedIn(page, user, PAGE)
    await hang(page)
    await press(page, readAloud.startButton)
    await expect.poll(() => lastSpoken(page)).toBe(sentences[0]?.say)
    await press(page, readAloud.dockButton('Next sentence'))
    await press(page, readAloud.dockButton('Next sentence'))
    await expect.poll(() => lastSpoken(page)).toBe(third.say)
    await press(page, readAloud.dockButton('Pause'))
    await sendUntil(page, (b) => b.listening?.some((l) => l.kind === 'voice' && l.offset === third.start) ?? false)

    const b = await otherDevice(browser, info)
    await fakeSpeech(b)
    await signedIn(b, user, BOOK_PAGE)
    await expect.poll(() => local(b, 'read-aloud-pos:pride-and-prejudice')).toContain(`"offset":${third.start}`)
    await hang(b)
    await press(b, new ReadAloud(b).startButton)
    await expect.poll(() => lastSpoken(b)).toBe(third.say)
    await b.context().close()
  })
})

test.describe('Sync across devices: whose browser it is', () => {
  test('a private book’s place follows the reader, and signing out leaves none of it for the next account', async ({
    page,
    request,
    browser,
    baseURL,
  }, info) => {
    const user = await createUser(request)
    await signedIn(page, user, PAGE)
    await sendUntil(page, readsOn('pride-and-prejudice', 'chapter-6', 2))
    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Field Diary',
      chapters: [
        { title: 'Opening', text: 'The first entry of the diary.' },
        { title: 'Second Entry', text: 'The second entry, a day later.' },
      ],
    })
    await page.goto(`/read/${book.slug}/second-entry`)
    await sendUntil(page, readsOn(book.slug, 'second-entry'))

    const b = await otherDevice(browser, info)
    await signedIn(b, user, '/library')
    const card = b.getByRole('region', { name: 'Continue reading' })
    await expect(card).toContainText('Field Diary')
    await b.evaluate((slug) => {
      localStorage.setItem(`ask:${slug}`, '{}')
      localStorage.setItem(`read-aloud-pos:${slug}`, '{"v":1,"done":true,"at":1}')
    }, book.slug)
    await open(b, '/account')
    await press(b, button(b, 'Sign out'))
    await expect(b).toHaveURL(/\/library$/)
    const left = await b.evaluate(() => ({
      recent: localStorage.getItem('recent-reading') ?? '[]',
      keys: Object.keys(localStorage),
    }))
    expect(left.recent).not.toContain('u-')
    expect(left.keys.filter((k) => k.startsWith('ask:u-') || k.startsWith('read-aloud-pos:u-'))).toEqual([])
    await b.context().close()

    await page.goto('/account')
    await press(page, button(page, 'Sign out'))
    await expect(page).toHaveURL(/\/library$/)
    const sent = sentBy.get(page) ?? []
    const before = sent.length
    await signedIn(page, await createUser(request), '/library')
    await expect(page.getByRole('region', { name: 'Continue reading' })).toHaveCount(0)
    expect(JSON.parse((await local(page, 'recent-reading')) ?? '[]')).toEqual([])
    /** The outbox sends in order, so anything left from the last account goes in or before this read's batch. */
    await page.goto('/read/the-prophet/the-coming-of-the-ship')
    await sendUntil(page, readsOn('the-prophet', 'the-coming-of-the-ship'))
    const later = sent.slice(before).map((s) => JSON.stringify(s.body))
    expect(later.filter((body) => body.includes('pride-and-prejudice') || body.includes(book.slug))).toEqual([])
  })

  test('nothing is sent while signed out or embedded, and embedded shows no offer', async ({
    page,
    request,
    readerPage,
  }) => {
    const sent: { method: string; body: string }[] = []
    page.on('request', (r) => {
      if (r.url().endsWith('/account/sync')) sent.push({ method: r.method(), body: r.postData() ?? '' })
    })
    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    await readerPage.goto('pride-and-prejudice', 'chapter-1', 2)
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.evaluate(() => localStorage.clear())

    const user = await createUser(request)
    await signedIn(page, user, '/library')
    await readerPage.goto('pride-and-prejudice', 'chapter-6?iframe=true')
    await expect(page.locator('html')).toHaveAttribute('data-embed', 'on')
    await readerPage.goto('pride-and-prejudice', 'chapter-6/2?iframe=true')
    await expect(page.locator('html')).toHaveAttribute('data-embed', 'on')
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await expect(bar(page)).toHaveCount(0)

    /** Read on, signed in and not embedded: anything queued before would go in or before this read's batch. */
    await readerPage.goto('pride-and-prejudice', 'chapter-7')
    await expect(page.locator('html')).not.toHaveAttribute('data-embed', 'on')
    await sendUntil(page, readsOn('pride-and-prejudice', 'chapter-7'))
    const batches = (sentBy.get(page) ?? []).map((s) => s.body)
    expect(batches.filter((batch) => !readsOn('pride-and-prejudice', 'chapter-7')(batch))).toEqual([])
    const leaked = sent.filter((s) => s.body.includes('"chapter-1"') || s.body.includes('"chapter-6"'))
    expect(leaked).toEqual([])
  })
})
