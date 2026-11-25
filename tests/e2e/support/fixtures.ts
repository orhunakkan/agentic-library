import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type Locator, type Page } from '@playwright/test'
import {
  AccountMenu,
  AccountPage,
  ArticlesPage,
  AudiobookPage,
  AudioPlayer,
  BookPage,
  DownloadControl,
  FlashcardsPage,
  HomePage,
  ImportPage,
  LibraryPage,
  LoginPage,
  PromptsPage,
  ProPage,
  ReadAloud,
  ReaderPage,
  ReposPage,
  RunDialog,
  SignupPage,
  SiteNav,
  StatsPage,
  UsersPage,
} from '../pages'
import { withoutRecognition } from './fake-recognition'
import { hydrated, settled } from './settle'

export { hydrated, settled }

export function settleNavigations(page: Page, javaScriptEnabled = true): Page {
  const goto = page.goto.bind(page)
  page.goto = async (url, options) => {
    const response = await goto(url, { waitUntil: 'networkidle', ...options })
    if (javaScriptEnabled) await hydrated(page)
    return response
  }
  return page
}

interface PageObjects {
  accountMenu: AccountMenu
  accountPage: AccountPage
  articlesPage: ArticlesPage
  audiobookPage: AudiobookPage
  audioPlayer: AudioPlayer
  bookPage: BookPage
  downloadControl: DownloadControl
  flashcardsPage: FlashcardsPage
  homePage: HomePage
  importPage: ImportPage
  libraryPage: LibraryPage
  loginPage: LoginPage
  proPage: ProPage
  readAloud: ReadAloud
  readerPage: ReaderPage
  promptsPage: PromptsPage
  reposPage: ReposPage
  runDialog: RunDialog
  signupPage: SignupPage
  siteNav: SiteNav
  statsPage: StatsPage
  usersPage: UsersPage
}

export const test = base.extend<{ page: Page } & PageObjects>({
  page: async ({ page, javaScriptEnabled }, use) => {
    await withoutRecognition(page)
    await use(settleNavigations(page, javaScriptEnabled !== false))
  },
  accountMenu: async ({ page }, use) => use(new AccountMenu(page)),
  accountPage: async ({ page }, use) => use(new AccountPage(page)),
  articlesPage: async ({ page }, use) => use(new ArticlesPage(page)),
  audiobookPage: async ({ page }, use) => use(new AudiobookPage(page)),
  audioPlayer: async ({ page }, use) => use(new AudioPlayer(page)),
  bookPage: async ({ page }, use) => use(new BookPage(page)),
  downloadControl: async ({ page }, use) => use(new DownloadControl(page)),
  flashcardsPage: async ({ page }, use) => use(new FlashcardsPage(page)),
  homePage: async ({ page }, use) => use(new HomePage(page)),
  importPage: async ({ page }, use) => use(new ImportPage(page)),
  libraryPage: async ({ page }, use) => use(new LibraryPage(page)),
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  proPage: async ({ page }, use) => use(new ProPage(page)),
  readAloud: async ({ page }, use) => use(new ReadAloud(page)),
  readerPage: async ({ page }, use) => use(new ReaderPage(page)),
  promptsPage: async ({ page }, use) => use(new PromptsPage(page)),
  reposPage: async ({ page }, use) => use(new ReposPage(page)),
  runDialog: async ({ page }, use) => use(new RunDialog(page)),
  signupPage: async ({ page }, use) => use(new SignupPage(page)),
  siteNav: async ({ page }, use) => use(new SiteNav(page)),
  statsPage: async ({ page }, use) => use(new StatsPage(page)),
  usersPage: async ({ page }, use) => use(new UsersPage(page)),
})

export { expect }

export async function expectAccessible(page: Page, options: { exclude?: string[] } = {}) {
  let violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'] = []
  for (let scan = 1; scan <= 3; scan++) {
    await settled(page)
    let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    for (const selector of options.exclude ?? []) builder = builder.exclude(selector)
    ;({ violations } = await builder.analyze())
    if (violations.length === 0 || !(await movedDuringScan(page, violations))) break
  }
  const summary = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n${v.nodes
        .slice(0, 8)
        .map((n) => `    ${n.target.join(' ')} ${n.any[0]?.message ?? ''}`)
        .join('\n')}`,
  )
  expect(summary, 'axe violations').toEqual([])
}

async function movedDuringScan(page: Page, violations: { nodes: { target: unknown[] }[] }[]) {
  const targets = violations.flatMap((v) => v.nodes.map((n) => n.target.filter((t) => typeof t === 'string').join(' ')))
  return page.evaluate((selectors) => {
    return selectors.some((selector) => {
      let element: Element | null
      try {
        element = document.querySelector(selector)
      } catch {
        return false
      }
      if (!element) return true
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (node.getAnimations().some((a) => a.playState === 'running')) return true
        if (Number(getComputedStyle(node).opacity) < 1) return true
      }
      return false
    })
  }, targets)
}

export async function imageLoaded(img: Locator) {
  await img.scrollIntoViewIfNeeded()
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
}

export async function expectNoSideways(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(0)
}

export async function swipe(page: Page, fromX: number, toX: number) {
  const target = page.locator('#reader-content')
  await expect.poll(() => target.boundingBox().catch(() => null), { timeout: 5_000 }).not.toBeNull()
  const box = await target.boundingBox()
  if (!box) throw new Error('no reader content')
  const y = box.y + 200
  await target.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: fromX, clientY: y }] })
  await target.dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: toX, clientY: y + 5 }] })
}
