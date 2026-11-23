import { expect, type Locator, type Page, type Response } from '@playwright/test'
import { hydrated } from '../support/settle'
import { AskPanel } from './components/ask-panel'
import { AudioPlayer } from './components/audio-player'
import { ContentsPanel } from './components/contents-panel'
import { isWide, press } from './layout'

export class ReaderPage {
  readonly content: Locator
  readonly pageNav: Locator
  readonly progress: Locator
  readonly contents: ContentsPanel
  readonly audio: AudioPlayer
  readonly ask: AskPanel
  readonly shareButton: Locator
  readonly settingsButton: Locator
  readonly settings: Locator
  readonly fullscreenButton: Locator
  readonly footnote: Locator
  readonly footnotes: Locator
  readonly tooltip: Locator
  readonly bookmarkRibbon: Locator
  readonly highlightPopover: Locator

  constructor(readonly page: Page) {
    this.content = page.locator('#reader-content')
    this.pageNav = page.getByRole('navigation', { name: 'Page navigation' })
    this.progress = page.getByRole('progressbar', { name: 'Progress in book' })
    this.contents = new ContentsPanel(page)
    this.audio = new AudioPlayer(page)
    this.ask = new AskPanel(page)
    this.shareButton = page.getByRole('button', { name: 'Share' }).filter({ visible: true })
    this.settingsButton = page.getByRole('button', { name: 'Settings' }).filter({ visible: true })
    this.fullscreenButton = page.getByRole('button', { name: 'Read fullscreen' }).filter({ visible: true })
    this.settings = page.getByRole('dialog', { name: 'Reading settings' })
    this.footnote = page.getByRole('dialog', { name: 'Footnote' })
    this.footnotes = page.getByRole('complementary', { name: 'Footnotes' })
    this.tooltip = page.getByRole('tooltip')
    this.bookmarkRibbon = page.getByRole('button', { name: 'Bookmark this page', exact: true })
    this.highlightPopover = page.getByRole('dialog', { name: 'Highlight' })
  }

  goto(book: string, ...at: (string | number)[]) {
    return this.page.goto(['/read', book, ...at].join('/'))
  }

  async turnPage() {
    const here = this.page.url()
    const next = this.pageNav.getByRole('link').last()
    await expect(next).not.toHaveAttribute('href', new URL(here).pathname)
    await press(this.page, next)
    await expect(this.page).not.toHaveURL(here)
  }

  pageLink(name: string) {
    return this.pageNav.getByRole('link', { name })
  }

  get glossedWord() {
    return this.page.locator('[data-gloss]').first()
  }

  footnoteButton(n: number) {
    return this.page.getByRole('button', { name: `Footnote ${n}` })
  }

  scrollPage(href: string) {
    return this.page.locator(`article[data-page-href="${href}"]`)
  }

  settingsTile(group: string, name: string) {
    return this.settings
      .getByRole('radiogroup', { name: group })
      .locator('label')
      .filter({ has: this.page.getByRole('radio', { name, exact: true }) })
  }

  async pickSetting(group: 'Reading mode' | 'Font', name: string) {
    await press(this.page, this.settingsButton)
    await press(this.page, this.settingsTile(group, name))
    await this.page.keyboard.press('Escape')
    await this.settings.waitFor({ state: 'hidden' })
  }

  button(name: string) {
    return this.page.getByRole('button', { name, exact: true })
  }

  paragraph(n = 0) {
    return this.page.locator('#reader-content [data-highlight-root] p').nth(n)
  }

  select(target: Locator) {
    return target.evaluate((el) => document.getSelection()?.selectAllChildren(el))
  }

  async selectWord(word: string) {
    await hydrated(this.page)
    await this.content.evaluate((root, w) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const match = new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'u').exec((node as Text).data)
        if (!match) continue
        node.parentElement?.scrollIntoView({ block: 'center' })
        const range = document.createRange()
        range.setStart(node, match.index)
        range.setEnd(node, match.index + w.length)
        document.getSelection()?.removeAllRanges()
        document.getSelection()?.addRange(range)
        return
      }
      throw new Error(`no "${w}" on the page`)
    }, word)
  }

  lookupCard(name: string) {
    return this.page.getByRole('dialog', { name })
  }

  async lookUp(word: string) {
    await this.selectWord(word)
    await press(this.page, this.button('Look up'))
    const card = this.lookupCard(word)
    await card.waitFor()
    return card
  }

  async toggleBookmark(path: 'new' | 'id' = 'new'): Promise<Response> {
    await expect(this.bookmarkRibbon).toBeEnabled()
    const answered = this.page.waitForResponse((r) =>
      path === 'new'
        ? r.url().endsWith('/account/bookmarks/new')
        : /\/account\/bookmarks\/[0-9a-f-]{36}$/.test(r.url()),
    )
    await press(this.page, this.bookmarkRibbon)
    return answered
  }

  async openHighlightPopover() {
    const box = await this.paragraph().boundingBox()
    if (!box) throw new Error('no paragraph')
    const point = { x: box.x + 24, y: box.y + 10 }
    if (isWide(this.page)) await this.page.mouse.click(point.x, point.y)
    else await this.page.touchscreen.tap(point.x, point.y)
    await this.highlightPopover.waitFor()
    return this.highlightPopover
  }
}
