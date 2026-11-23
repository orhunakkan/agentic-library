import type { Locator, Page } from '@playwright/test'
import { expect, expectAccessible, expectNoSideways, swipe, test } from '../support/fixtures'

const MIN_TARGET = 44

async function expectTappable(target: Locator, name: string) {
  const box = await target.boundingBox()
  expect(box, `${name} is on screen`).not.toBeNull()
  expect(Math.round(box?.width ?? 0), `${name} width`).toBeGreaterThanOrEqual(MIN_TARGET)
  expect(Math.round(box?.height ?? 0), `${name} height`).toBeGreaterThanOrEqual(MIN_TARGET)
}

async function expectInsideViewport(page: Page, target: Locator, name: string) {
  const viewport = page.viewportSize()
  let last = 'not on screen'
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox()
        if (!box || !viewport) return false
        last = `x ${box.x.toFixed(0)}–${(box.x + box.width).toFixed(0)}, y ${box.y.toFixed(0)}–${(box.y + box.height).toFixed(0)} in ${viewport.width}×${viewport.height}`
        return (
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= viewport.width + 0.5 &&
          box.y + box.height <= viewport.height + 0.5
        )
      },
      { message: `${name} fits on screen`, intervals: [100, 200, 400] },
    )
    .toBe(true)
    .catch((error: Error) => {
      throw new Error(`${error.message}\nLast position: ${last}`)
    })
}

test.describe('iPhone', () => {
  test('pages fit the screen without sideways scrolling', async ({ page }) => {
    for (const path of [
      '/library',
      '/library/jane-austen',
      '/library/jane-austen/pride-and-prejudice',
      '/read/pride-and-prejudice/chapter-6/2',
      '/read/fixture-code-book/lists-and-tables',
      '/read/confessions-of-al-ghazzali/39',
    ]) {
      await page.goto(path)
      await expectNoSideways(page)
    }
  })

  test('header and reader controls are big enough to tap', async ({ page, readerPage, siteNav }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-6', 2)
    await expectTappable(page.getByRole('button', { name: 'Search' }), 'Search')
    await expectTappable(page.getByRole('button', { name: /theme/ }), 'Theme')
    await expectTappable(siteNav.menuButton, 'Menu')
    await expectTappable(readerPage.contents.toolbarButton, 'Contents')
    await expectTappable(readerPage.shareButton, 'Share')
    await expectTappable(readerPage.settingsButton, 'Settings')
    await expectTappable(readerPage.fullscreenButton, 'Fullscreen')
    const pageNav = readerPage.pageNav
    await expectTappable(pageNav.getByRole('link', { name: 'Previous page' }), 'Previous page')
    await expectTappable(pageNav.getByRole('link', { name: 'Next page' }), 'Next page')
  })

  test('the reader leaves at least half the screen for text', async ({ page, readerPage }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-6', 2)
    const viewport = page.viewportSize()
    const topChrome = await page.evaluate(() =>
      Math.max(
        ...[...document.querySelectorAll('[data-chrome]')].map((el) => {
          const r = el.getBoundingClientRect()
          const sticky = getComputedStyle(el).position
          return (sticky === 'sticky' || sticky === 'fixed') && r.top < 1 + window.innerHeight / 3 ? r.bottom : 0
        }),
      ),
    )
    const bottomBar = await readerPage.pageNav.boundingBox()
    expect(viewport && bottomBar).toBeTruthy()
    const readable = (bottomBar?.y ?? 0) - topChrome
    expect(readable, `text area ${readable}px of ${viewport?.height}px`).toBeGreaterThanOrEqual(
      (viewport?.height ?? 0) / 2,
    )
  })

  test('the contents drawer, footnote sheet and settings fit on screen', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 39)
    await readerPage.contents.toolbarButton.tap()
    const drawer = readerPage.contents.drawer
    await expect(drawer).toBeVisible()
    await expectInsideViewport(page, drawer, 'Contents drawer')
    await expectTappable(drawer.getByRole('button', { name: 'Close' }), 'Close contents')
    await drawer.getByRole('button', { name: 'Close' }).tap()
    await expect(drawer).toHaveCount(0)

    await readerPage.footnoteButton(1).tap()
    const sheet = readerPage.footnote
    await expect(sheet).toContainText('In the Mosque of Omar.')
    await expectInsideViewport(page, sheet, 'Footnote sheet')
    await expectTappable(sheet.getByRole('button', { name: 'Close' }), 'Close footnote')
    await sheet.getByRole('button', { name: 'Close' }).tap()
    await expect(sheet).toHaveCount(0)

    await readerPage.settingsButton.tap()
    const settings = readerPage.settings
    await expect(settings).toBeVisible()
    await expect(settings.getByText('Contents panel')).toHaveCount(0)
    await expectInsideViewport(page, settings, 'Reading settings')
    await settings.getByText('Dark').tap()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'dark')
  })

  test('swiping turns pages', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 8)
    const width = page.viewportSize()?.width ?? 390
    await swipe(page, width * 0.85, width * 0.2)
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/9')
    await expect(page.getByText('Chapter 1 · Page 3 of 3')).toBeVisible()
    await swipe(page, width * 0.2, width * 0.85)
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/8')
  })

  test('the mini player sits below the reader’s page bar and can be used by touch', async ({
    page,
    audioPlayer,
    bookPage,
    readerPage,
  }) => {
    await bookPage.goto('poetry-of-the-spirit', 'the-prophet', '?tab=audio')
    await page.getByRole('button', { name: /^Play On Love/ }).tap()
    const dock = audioPlayer.dock
    await expect(dock).toBeVisible()
    await expectTappable(dock.getByRole('button', { name: /^(Play|Pause)$/ }), 'Play/Pause')
    await expectTappable(dock.getByRole('button', { name: 'Close player' }), 'Close player')

    await readerPage.goto('the-prophet', 'on-love')
    await bookPage.goto('poetry-of-the-spirit', 'the-prophet', '?tab=audio')
    await page.getByRole('button', { name: /^Play On Love/ }).tap()
    await page.getByRole('button', { name: /Open player: On Love/ }).tap()
    const sheet = audioPlayer.sheet
    await expectNoSideways(page)
    await sheet.getByRole('button', { name: 'Go to page' }).tap()
    await expect(page).toHaveURL('/read/the-prophet/on-love')

    const bar = await readerPage.pageNav.boundingBox()
    const player = await dock.boundingBox()
    expect(bar && player).toBeTruthy()
    expect((bar?.y ?? 0) + (bar?.height ?? 0), 'page bar ends above the player').toBeLessThanOrEqual(
      (player?.y ?? 0) + 0.5,
    )
  })

  test('the library and reader pass accessibility checks', async ({ page, libraryPage, readerPage }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'phone',
      'The phone layout is the same at every phone size; one scan is enough.',
    )
    await libraryPage.goto()
    await expectAccessible(page)
    await readerPage.goto('confessions-of-al-ghazzali', 7)
    await expectAccessible(page)
  })
})
