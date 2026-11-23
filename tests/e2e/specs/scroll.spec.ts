import type { Locator, Page } from '@playwright/test'
import { isWide, press, type ReaderPage } from '../pages'
import { signedInAt } from '../support/accounts'
import { fakeSpeech, hang, marked } from '../support/fake-speech'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'

const CH6 = '/read/pride-and-prejudice/chapter-6'
const at = (n: number) => (n === 1 ? CH6 : `${CH6}/${n}`)

const historyLength = (page: Page) => page.evaluate(() => history.length)
const scrollY = (page: Page) => page.evaluate(() => window.scrollY)

const scrollMode = (page: Page) =>
  page.addInitScript(() => {
    if (!localStorage.getItem('reader-prefs'))
      localStorage.setItem('reader-prefs', JSON.stringify({ layout: 'scroll' }))
  })

const startsWith = (family: string) => new RegExp(`^"?${family}"?,`)

async function scrollUntil(page: Page, target: Locator) {
  await expect(async () => {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8))
    await expect(target).toBeAttached({ timeout: 250 })
  }).toPass({ intervals: [0], timeout: 20_000 })
}

const scrollUntilLoaded = (readerPage: ReaderPage, href: string) =>
  scrollUntil(readerPage.page, readerPage.scrollPage(href))

async function topAt(page: Page, href: string, fraction: number) {
  await page.evaluate(
    ({ href, fraction }) => {
      const el = document.querySelector(`article[data-page-href="${href}"]`)
      if (el) window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight * fraction)
    },
    { href, fraction },
  )
}

const offTarget = (page: Page, href: string) =>
  page.evaluate(
    ({ href, phone }) => {
      const el = document.querySelector(`article[data-page-href="${href}"]`)
      const nav = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--site-nav-h')) || 0
      return el ? Math.abs(el.getBoundingClientRect().top - (nav + (phone ? 48 : 16))) : Number.POSITIVE_INFINITY
    },
    { href, phone: !isWide(page) },
  )

async function scrollToEnd(page: Page) {
  const card = page.getByRole('link', { name: /^Next chapter/ })
  await scrollUntil(page, card)
  await card.scrollIntoViewIfNeeded()
  return card
}

test.describe('Scroll mode', () => {
  test('the column loads as it scrolls, the address follows without new history, and a reload keeps it', async ({
    page,
    readerPage,
  }) => {
    await scrollMode(page)
    await page.goto(CH6)
    const entries = await historyLength(page)
    await expect(page.locator('html')).toHaveAttribute('data-reader-layout', 'scroll')
    await expect(readerPage.scrollPage(at(1))).toBeVisible()

    for (const n of [2, 3]) {
      await scrollUntilLoaded(readerPage, at(n))
      await topAt(page, at(n), 0.2)
      const y = await scrollY(page)
      await expect(page).toHaveURL(at(n))
      expect(Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(1)
    }
    await expect(readerPage.pageNav).toContainText('Chapter 6 · Page 3 of 4')
    await expect(page).toHaveTitle(/^Chapter 6 \|/)
    expect(await historyLength(page)).toBe(entries)

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-reader-layout', 'scroll')
    await expect(page).toHaveURL(at(3))
    const earlier = readerPage.button('Show earlier pages')
    await expect(earlier).toBeVisible()
    await expect(readerPage.scrollPage(at(2))).toHaveCount(0)
    await expectAccessible(page)

    await earlier.scrollIntoViewIfNeeded()
    const firstVisible = async () =>
      page.evaluate((href) => {
        const paragraphs = [...document.querySelectorAll(`article[data-page-href="${href}"] p`)]
        const p = paragraphs.find((el) => el.getBoundingClientRect().top >= 0)
        return p ? { index: paragraphs.indexOf(p), top: p.getBoundingClientRect().top } : null
      }, at(3))
    const before = await firstVisible()
    expect(before).not.toBeNull()
    await earlier.dispatchEvent('click')
    await expect(readerPage.scrollPage(at(2))).toBeAttached()
    await expect(earlier).toBeAttached()
    const after = await page.evaluate(
      ({ href, index }) =>
        document.querySelectorAll(`article[data-page-href="${href}"] p`)[index]?.getBoundingClientRect().top ?? null,
      { href: at(3), index: before?.index ?? 0 },
    )
    expect(Math.abs((after ?? 0) - (before?.top ?? 0))).toBeLessThan(2)
    await press(page, earlier)
    await expect(readerPage.scrollPage(at(1))).toBeAttached()
    await expect(earlier).toHaveCount(0)
  })

  test('next and → scroll to the next page; the end card opens the next chapter as a new entry', async ({
    page,
    readerPage,
  }) => {
    await scrollMode(page)
    await page.goto(CH6)
    await press(page, readerPage.pageLink('Next page'))
    await expect(readerPage.scrollPage(at(2))).toBeAttached()
    await expect.poll(() => offTarget(page, at(2))).toBeLessThan(4)
    await expect(page).toHaveURL(at(2))

    await readerPage.content.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => offTarget(page, at(3))).toBeLessThan(4)
    await expect(page).toHaveURL(at(3))
    await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0)

    const entries = await historyLength(page)
    const card = await scrollToEnd(page)
    await expect(card).toContainText('Chapter 7')
    await expectAccessible(page)
    await expectNoSideways(page)
    await press(page, card)
    await expect(page).toHaveURL('/read/pride-and-prejudice/chapter-7')
    expect(await historyLength(page)).toBe(entries + 1)
    await expect(readerPage.scrollPage('/read/pride-and-prejudice/chapter-7')).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/read\/pride-and-prejudice\/chapter-6(\/\d)?$/)
  })

  test('switching back to Pages opens the page at the reading line, at its top', async ({ page, readerPage }) => {
    await page.goto(CH6)
    await readerPage.pickSetting('Reading mode', 'Scroll')
    await scrollUntilLoaded(readerPage, at(2))
    await topAt(page, at(2), 0.1)
    await expect(page).toHaveURL(at(2))
    await readerPage.pickSetting('Reading mode', 'Pages')
    await expect(page.locator('html')).toHaveAttribute('data-reader-layout', 'pages')
    await expect(page.locator('article[data-page-href]')).toHaveCount(0)
    await expect(page).toHaveURL(at(2))
    await expect(readerPage.pageNav).toContainText('Page 2 of 4')
    await expect.poll(() => scrollY(page)).toBe(0)
  })

  test('a highlight and a bookmark belong to the page they are on, not the address', async ({ page, readerPage }) => {
    await scrollMode(page)
    await signedInAt(page, at(2))
    await scrollUntilLoaded(readerPage, at(3))
    await topAt(page, at(3), 0.25)
    await expect(page).toHaveURL(at(3))

    const last = readerPage.scrollPage(at(2)).locator('[data-highlight-root] p').last()
    await last.evaluate((el) => document.getSelection()?.selectAllChildren(el))
    const saved = page.waitForResponse((r) => r.url().endsWith('/account/highlights/new'))
    await press(page, readerPage.button('Highlight'))
    const response = await saved
    expect(response.status()).toBe(201)
    const { highlight } = (await response.json()) as { highlight: { place: { label: string } } }
    expect(highlight.place.label).toBe('Ch. 6 · p. 2')
    await expect(page).toHaveURL(at(3))

    const ribbon = readerPage.scrollPage(at(2)).getByRole('button', { name: 'Bookmark this page' })
    await expect(ribbon).toBeEnabled()
    const bookmarked = page.waitForResponse((r) => r.url().endsWith('/account/bookmarks/new'))
    await ribbon.scrollIntoViewIfNeeded()
    await press(page, ribbon)
    const answer = await bookmarked
    expect(answer.status()).toBe(201)
    const { bookmark } = (await answer.json()) as { bookmark: { place: { label: string } } }
    expect(bookmark.place.label).toBe('Ch. 6 · p. 2')
    await expect(ribbon).toHaveAttribute('aria-pressed', 'true')
    await expect(readerPage.scrollPage(at(3)).getByRole('button', { name: 'Bookmark this page' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('read aloud scrolls the column with the voice; a wheel stops following and Follow the voice comes back', async ({
    page,
    isMobile,
    readerPage,
  }) => {
    await page.clock.install()
    await fakeSpeech(page)
    await scrollMode(page)
    await page.goto(at(2))
    const entries = await historyLength(page)
    await press(page, readerPage.button('Read aloud'))
    const dock = page.getByRole('region', { name: 'Read aloud' })
    await expect(dock).toBeVisible()
    await expect(async () => {
      await page.clock.runFor(500)
      await expect(page).toHaveURL(at(3), { timeout: 100 })
    }).toPass({ intervals: [0], timeout: 20_000 })
    await expect(readerPage.scrollPage(at(2))).toBeAttached()
    expect(await historyLength(page)).toBe(entries)
    await hang(page)
    await page.clock.resume()
    await expect.poll(() => marked(page)).not.toBeNull()

    if (isMobile) await readerPage.content.dispatchEvent('touchmove')
    else await page.mouse.wheel(0, -1500)
    const follow = dock.getByRole('button', { name: 'Follow the voice' })
    await expect(follow).toBeVisible()
    await page.evaluate(() => window.scrollTo({ top: 0 }))
    await press(page, follow)
    await expect(follow).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const range = [...(CSS.highlights.get('ra-sentence') ?? [])][0] as Range | undefined
          const rect = range?.getBoundingClientRect()
          return rect ? rect.top >= 0 && rect.bottom <= window.innerHeight : false
        }),
      )
      .toBe(true)
  })

  test('a paged book: footnotes and glossary terms work on a page loaded below', async ({ page, readerPage }) => {
    const PAGED = '/read/confessions-of-al-ghazzali'
    await scrollMode(page)
    await page.goto(`${PAGED}/38`)
    await scrollUntilLoaded(readerPage, `${PAGED}/39`)
    const later = readerPage.scrollPage(`${PAGED}/39`)
    await expect(later).toHaveAttribute('aria-label', 'Page 39')
    await later.getByRole('button', { name: 'Footnote 1' }).scrollIntoViewIfNeeded()
    await press(page, later.getByRole('button', { name: 'Footnote 1' }))
    const sheet = readerPage.footnote
    await expect(sheet).toContainText('In the Mosque of Omar.')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    const term = later.locator('[data-gloss]').first()
    await term.scrollIntoViewIfNeeded()
    await press(page, term)
    await expect(term).toHaveAttribute('aria-expanded', 'true')
    await expect(later.getByRole('tooltip')).toBeVisible()
  })

  test('keyboard only: Tab reaches Show earlier pages, each ribbon and the end card', async ({
    page,
    readerPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard reading on a desktop browser.')
    await scrollMode(page)
    await page.goto(at(3))
    await scrollToEnd(page)
    await page.evaluate(() => window.scrollTo({ top: 0 }))
    await readerPage.content.focus()
    const reached: string[] = []
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      reached.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          return `${el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? ''}`
        }),
      )
    }
    expect(reached.slice(0, 4)).toEqual([
      'Show earlier pages',
      'Bookmark this page',
      'Bookmark this page',
      expect.stringMatching(/^Next chapter\s*Chapter 7$/),
    ])
  })
})

test.describe('Reading fonts', () => {
  const FONTS = [
    ['Source Serif', 'Source Serif 4 Variable'],
    ['Geist', 'Geist Variable'],
    ['Atkinson Hyperlegible', 'Atkinson Hyperlegible Next Variable'],
    ['OpenDyslexic', 'OpenDyslexic'],
    ['Literata', 'Literata Variable'],
  ] as const
  const pageFont = (readerPage: ReaderPage) =>
    readerPage.content.evaluate((el) => {
      const prose = el.matches('.prose-reader') ? el : el.querySelector('.prose-reader')
      return prose ? getComputedStyle(prose).fontFamily : ''
    })

  test('each font applies to the page at once, not to the reader’s UI, a reload opens in it, and so does a gloss card', async ({
    page,
    readerPage,
  }) => {
    await page.goto(CH6)
    const settingsFont = () => readerPage.settingsButton.evaluate((el) => getComputedStyle(el).fontFamily)
    const ui = await settingsFont()
    await press(page, readerPage.settingsButton)
    const group = readerPage.settings.getByRole('radiogroup', { name: 'Font' })
    await expect(group.getByRole('radio')).toHaveCount(5)
    const tileFont = (name: string) =>
      readerPage
        .settingsTile('Font', name)
        .locator('span')
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(await tileFont('Atkinson Hyperlegible')).toMatch(startsWith('Atkinson Hyperlegible Next Variable'))
    expect(await tileFont('OpenDyslexic')).toMatch(startsWith('OpenDyslexic'))
    await expectAccessible(page)
    for (const [label, family] of FONTS) {
      await press(page, readerPage.settingsTile('Font', label))
      await expect.poll(() => pageFont(readerPage)).toMatch(startsWith(family))
      expect(await settingsFont()).toBe(ui)
    }
    await press(page, readerPage.settingsTile('Font', 'OpenDyslexic'))
    await page.keyboard.press('Escape')
    await expect(readerPage.settings).toBeHidden()

    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        const prose = document.querySelector('.prose-reader')
        if (!prose) return
        ;(window as unknown as { __firstFont: string }).__firstFont = getComputedStyle(prose).fontFamily
        observer.disconnect()
      }).observe(document, { childList: true, subtree: true })
    })
    await page.reload()
    expect(await page.evaluate(() => (window as unknown as { __firstFont: string }).__firstFont)).toMatch(
      startsWith('OpenDyslexic'),
    )

    await readerPage.goto('confessions-of-al-ghazzali', 7)
    await press(page, readerPage.glossedWord)
    await expect(readerPage.tooltip).toBeVisible()
    expect(await readerPage.tooltip.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
      startsWith('OpenDyslexic'),
    )
  })
})
