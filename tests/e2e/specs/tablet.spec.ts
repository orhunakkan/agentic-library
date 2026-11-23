import { isWide } from '../pages'
import { expect, expectAccessible, expectNoSideways, swipe, test } from '../support/fixtures'

test.describe('iPad', () => {
  test('pages fit the screen without sideways scrolling', async ({ page }) => {
    for (const path of [
      '/library',
      '/library/jane-austen/pride-and-prejudice',
      '/read/pride-and-prejudice/chapter-6/2',
      '/read/fixture-code-book/lists-and-tables',
      '/read/confessions-of-al-ghazzali/39',
    ]) {
      await page.goto(path)
      await expectNoSideways(page)
    }
  })

  test('site navigation reaches a series and back to the library', async ({ page, bookPage, siteNav }) => {
    await bookPage.goto('jane-austen', 'pride-and-prejudice')
    let nav = await siteNav.open('tap')
    await nav.getByRole('link', { name: /^Jane Austen/ }).tap()
    await expect(page).toHaveURL('/library/jane-austen')
    nav = await siteNav.open('tap')
    await nav.getByRole('link', { name: 'Library', exact: true }).tap()
    await expect(page).toHaveURL('/library')
  })

  test('the reader uses the layout that fits the orientation', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 8)
    const panel = readerPage.contents.panel
    if (isWide(page)) {
      await expect(panel).toBeVisible()
      await expect(panel.getByRole('link', { name: /Introduction/ })).toHaveAttribute('aria-current', 'page')
    } else {
      await expect(panel).toBeHidden()
      await readerPage.contents.toolbarButton.tap()
      const drawer = readerPage.contents.drawer
      await expect(drawer.getByRole('link', { name: /Introduction/ })).toHaveAttribute('aria-current', 'page')
      await drawer.getByRole('button', { name: 'Close' }).tap()
      await expect(drawer).toHaveCount(0)
    }
    await expectAccessible(page)
  })

  test('tapping a glossary term shows its meaning; tapping elsewhere hides it', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 7)
    await readerPage.glossedWord.tap()
    await expect(readerPage.tooltip).toBeVisible()
    await page.locator('#reader-content h1').tap()
    await expect(readerPage.tooltip).toHaveCount(0)
  })

  test('tapping a footnote opens the sheet', async ({ readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 39)
    await readerPage.footnoteButton(1).tap()
    const sheet = readerPage.footnote
    await expect(sheet).toContainText('In the Mosque of Omar.')
    await sheet.getByRole('button', { name: 'Close' }).tap()
    await expect(sheet).toHaveCount(0)
  })

  test('swiping turns pages', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 8)
    const width = page.viewportSize()?.width ?? 800
    await swipe(page, width * 0.8, width * 0.3)
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/9')
    await expect(page.getByText('Chapter 1 · Page 3 of 3')).toBeVisible()
    await swipe(page, width * 0.3, width * 0.8)
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/8')
  })

  test('reading settings fit on screen and respond to taps', async ({ page, readerPage }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    await readerPage.settingsButton.tap()
    const panel = readerPage.settings
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    const viewport = page.viewportSize()
    expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true)
    await expect(panel.getByText('Contents panel')).toHaveCount(isWide(page) ? 1 : 0)
    await panel.getByText('Sepia').tap()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'sepia')
  })

  test('the audio player can be driven by touch', async ({ page, audioPlayer, bookPage }) => {
    await bookPage.goto('poetry-of-the-spirit', 'the-prophet', '?tab=audio')
    await page.getByRole('button', { name: /^Play On Love/ }).tap()
    await page.getByRole('button', { name: /Open player: On Love/ }).tap()
    const sheet = audioPlayer.sheet
    await expect(sheet).toBeVisible()
    await expectNoSideways(page)
    await sheet.getByRole('button', { name: 'Next' }).tap()
    await expect(sheet.getByRole('button', { name: 'On Marriage' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Minimize' }).tap()
    await expect(sheet).toHaveCount(0)
    await expect(audioPlayer.dock).toContainText('On Marriage')
  })
})

test.describe('iPad first paint (server-rendered, before JavaScript runs)', () => {
  test.use({ javaScriptEnabled: false })

  test('the reader already has the right layout for the screen width', async ({ page, readerPage }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    const rail = readerPage.contents.panel
    const toolbarContents = readerPage.contents.toolbarButton
    if (isWide(page)) {
      await expect(rail).toBeVisible()
      await expect(toolbarContents).toBeHidden()
    } else {
      await expect(rail).toBeHidden()
      await expect(toolbarContents).toBeVisible()
    }
    await expect(readerPage.shareButton).toHaveCount(1)
  })
})
