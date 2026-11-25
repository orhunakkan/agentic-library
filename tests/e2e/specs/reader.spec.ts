import { expect, expectAccessible, test } from '../support/fixtures'

test.describe('Paged reader', () => {
  test('chapter-start page: header, Arabic, glossary, title and bottom bar', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 7)
    await expect(page).toHaveTitle('The Confessions of Al-Ghazzali › Introduction › Birth of Ghazzali | The Inner Path')
    const article = readerPage.content
    await expect(article.getByText('Chapter 1', { exact: true })).toBeVisible()
    await expect(article.getByRole('heading', { level: 1, name: 'Introduction' })).toBeVisible()
    const arabic = article.locator('[lang="ar"]').first()
    await expect(arabic).toHaveAttribute('dir', 'rtl')

    const nav = readerPage.pageNav
    await expect(nav.getByText('Start of book')).toBeVisible()
    await expect(nav.getByText('Chapter 1 · Page 1 of 3')).toBeVisible()
    await expect(readerPage.progress).toHaveAttribute('aria-valuenow', '1')
    await expect(readerPage.contents.nav.getByRole('link', { name: /Introduction/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByRole('link', { name: 'Birth of Ghazzali' })).toHaveAttribute('data-active-leaf', 'true')
    await expectAccessible(page)
  })

  test('a glossed word shows its meaning on click and hides on outside click', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 7)
    const term = readerPage.glossedWord
    await term.click()
    const tip = readerPage.tooltip
    await expect(tip).toBeVisible()
    await expect(term).toHaveAttribute('aria-expanded', 'true')
    await page.locator('#reader-content h1').click()
    await expect(tip).toHaveCount(0)
  })

  test('footnotes open in a bottom sheet from the badge and from the list', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 39)
    await readerPage.footnoteButton(1).click()
    const sheet = readerPage.footnote
    await expect(sheet).toContainText('In the Mosque of Omar.')
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toHaveCount(0)
    await readerPage.footnotes.getByRole('button').first().click()
    await expect(readerPage.footnote).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(readerPage.footnote).toHaveCount(0)
  })

  test('arrow keys turn pages; modified keys and inputs are ignored', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 8)
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/9')
    await expect(page.getByText('Chapter 1 · Page 3 of 3')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/10')
    await expect(page.getByText('Chapter 2 · Page 1 of 4')).toBeVisible()
    await expect(readerPage.pageLink('Introduction')).toBeVisible()
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/9')

    await readerPage.goto('confessions-of-al-ghazzali', 13)
    await readerPage.pageNav.getByRole('link', { name: 'The Subterfuges of the Sophists' }).click()
    await expect(page).toHaveURL('/read/confessions-of-al-ghazzali/14')
    await readerPage.goto('confessions-of-al-ghazzali', 50)
    await expect(readerPage.pageNav.locator('[aria-disabled="true"]')).toHaveText('End of book')
  })

  test('pages outside the book, and a chapter’s /1 or a page past its end, are 404', { tag: '@http' }, async ({
    request,
  }) => {
    for (const path of [
      '/read/confessions-of-al-ghazzali/6',
      '/read/confessions-of-al-ghazzali/51',
      '/read/nope/7',
      '/read/pride-and-prejudice/chapter-6/1',
      '/read/pride-and-prejudice/chapter-6/5',
    ])
      expect((await request.get(path)).status(), path).toBe(404)
  })

  test('the contents panel collapses, persists, and restores', async ({ page, readerPage }) => {
    await readerPage.goto('confessions-of-al-ghazzali', 7)
    await readerPage.contents.hideButton.click()
    await expect(readerPage.contents.panel).toBeHidden()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-reader-sidebar', 'hidden')
    await expect(readerPage.contents.panel).toBeHidden()
    await readerPage.contents.toolbarButton.click()
    await expect(readerPage.contents.panel).toBeVisible()
  })
})

test.describe('Reading settings', () => {
  test('theme, size, spacing and width apply instantly and survive a reload; size stops at its bounds', async ({
    page,
    readerPage,
  }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    await readerPage.settingsButton.click()
    const panel = readerPage.settings
    await expect(panel).toBeVisible()
    await expectAccessible(page)

    await panel.getByText('Sepia').click()
    await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'sepia')
    const selected = panel.locator('label').filter({ hasText: 'Sepia' })
    await expect.poll(() => selected.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(138, 90, 43)')
    await panel.getByRole('button', { name: 'Increase font size' }).click()
    await expect(panel.getByText('Font size 21 pixels')).toBeAttached()
    await panel.getByText('Relaxed').click()
    await panel.getByText('Wide').click()

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(readerPage.settingsButton).toBeFocused()

    await page.reload()
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-reader-theme', 'sepia')
    expect(await html.evaluate((el) => el.style.getPropertyValue('--reader-font-size'))).toBe('21px')
    expect(await html.evaluate((el) => el.style.getPropertyValue('--reader-leading'))).toBe('2.15')
    expect(await html.evaluate((el) => el.style.getPropertyValue('--reader-measure'))).toBe('780px')

    await readerPage.settingsButton.click()
    const bigger = readerPage.settings.getByRole('button', { name: 'Increase font size' })
    for (let i = 0; i < 3; i++) await bigger.click()
    await expect(bigger).toBeDisabled()
    await expect(readerPage.settings.getByText('Font size 27 pixels')).toBeAttached()
  })

  test('dark reader theme passes accessibility checks, code and tables included', async ({ page, readerPage }) => {
    await readerPage.goto('fixture-code-book', 'lists-and-tables')
    await readerPage.settingsButton.click()
    await readerPage.settings.getByText('Dark').click()
    await page.keyboard.press('Escape')
    await expectAccessible(page)
  })
})

test.describe('Chapter reader', () => {
  test('screen pages use /<n> from page 2', async ({ page, readerPage }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-6')
    await expect(page).toHaveTitle('Chapter 6 | Folio')
    await readerPage.pageLink('Next page').click()
    await expect(page).toHaveURL('/read/pride-and-prejudice/chapter-6/2')
    await expect(page.getByText('Chapter 6 · Page 2 of 4')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
  })

  test('share falls back to copying the link', async ({ page, readerPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'What is copied, not where; one browser is enough.')
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined })
      const copied: string[] = []
      Object.assign(window, { __copied: copied })
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (text: string) => void copied.push(text) },
      })
    })
    await readerPage.goto('pride-and-prejudice', 'chapter-6', 3)
    await readerPage.shareButton.click()
    await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([
      expect.stringMatching(/\/read\/pride-and-prejudice\/chapter-6\/3$/),
    ])
  })

  test('a Share button is reachable at every width', async ({ page, readerPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Sets its own viewport; one browser is enough.')
    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    for (const width of [600, 899, 900, 960, 1023, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(readerPage.shareButton, `at ${width}px`).toHaveCount(1)
    }
  })

  test('fullscreen hides the site chrome and can be exited', async ({ page, readerPage }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-1')
    await readerPage.fullscreenButton.click()
    await expect(page.locator('html')).toHaveAttribute('data-reader-fullscreen', 'on')
    await expect(page.locator('header').first()).toBeHidden()
    await expect(readerPage.pageNav).toBeHidden()
    await page.getByRole('button', { name: 'Exit fullscreen' }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-reader-fullscreen', 'on')
    await expect(page.locator('header').first()).toBeVisible()
  })

  test('embedded mode hides the site header', async ({ page, readerPage }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-1?iframe=true')
    await expect(page.locator('html')).toHaveAttribute('data-embed', 'on')
    await expect(page.locator('header').first()).toBeHidden()
  })

  test('remembers the last page for “Continue reading”, leaving out books no longer in the library', async ({
    page,
    libraryPage,
    readerPage,
  }) => {
    await readerPage.goto('pride-and-prejudice', 'chapter-1', 2)
    await page.evaluate(() => {
      const recent = JSON.parse(localStorage.getItem('recent-reading') ?? '[]')
      const removed = {
        bookSlug: 'a-removed-book',
        bookTitle: 'A Removed Book',
        chapterTitle: 'Chapter',
        href: '/read/a-removed-book/start',
        at: Date.now() + 1000,
      }
      localStorage.setItem('recent-reading', JSON.stringify([removed, ...recent]))
    })
    await libraryPage.goto()
    const continueReading = page.getByRole('region', { name: 'Continue reading' })
    await expect(continueReading.getByRole('link')).toHaveCount(1)
    await expect(continueReading.getByRole('link', { name: /Pride and Prejudice/ })).toHaveAttribute(
      'href',
      '/read/pride-and-prejudice/chapter-1/2',
    )
  })
})
