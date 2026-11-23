import { expect, expectAccessible, test } from '../support/fixtures'

test.describe('Library', () => {
  test('shows the hero, catalog stats and every shelf, each an anchor target', async ({ page, libraryPage }) => {
    await libraryPage.goto('#code-fixtures')
    await expect(libraryPage.shelf('code-fixtures')).toBeInViewport()
    await expect(libraryPage.heading).toBeVisible()
    await expect(libraryPage.stats.getByRole('term')).toHaveText(['Books', 'Series', 'Audiobooks'])
    await expect(libraryPage.stats.getByRole('definition')).toHaveText(['5', '4', '1'])
    await expect(libraryPage.showing(5)).toBeVisible()
    await expect(libraryPage.shelves).toHaveCount(4)
    for (const [i, id] of ['inner-path', 'jane-austen', 'poetry-of-the-spirit', 'code-fixtures'].entries())
      await expect(libraryPage.shelves.nth(i)).toHaveAttribute('id', id)
    await expectAccessible(page)
  })

  test('serves Open Graph cards and generated covers', { tag: '@http' }, async ({ request }) => {
    const html = await (await request.get('/library/jane-austen/pride-and-prejudice')).text()
    expect(html).toContain('<meta property="og:image" content="/og/book/pride-and-prejudice.png"/>')
    for (const path of ['/og/library.png', '/og/series/jane-austen.png', '/og/book/pride-and-prejudice.png']) {
      const res = await request.get(path)
      expect(res.status(), path).toBe(200)
      expect(res.headers()['content-type']).toBe('image/png')
      expect((await res.body()).subarray(1, 4).toString()).toBe('PNG')
    }
    expect((await request.get('/og/book/nope.png')).status()).toBe(404)
    expect((await request.get('/covers/pride-and-prejudice.svg')).headers()['content-type']).toContain('image/svg+xml')
  })

  test('old /works links redirect permanently to the same page under /library', { tag: '@http' }, async ({
    request,
  }) => {
    for (const [from, to] of [
      ['/works', '/library'],
      ['/works?q=poetry', '/library?q=poetry'],
      ['/works/jane-austen', '/library/jane-austen'],
      ['/works/jane-austen/pride-and-prejudice', '/library/jane-austen/pride-and-prejudice'],
    ] as const) {
      const res = await request.get(from, { maxRedirects: 0 })
      expect(res.status(), from).toBe(301)
      expect(res.headers().location, from).toBe(to)
    }
  })

  test('filters live, ignores case and spacing, and syncs the query to the URL', async ({ page, libraryPage }) => {
    await libraryPage.goto('?q=prophet')
    await expect(libraryPage.search).toHaveValue('prophet')
    await expect(libraryPage.showing(1)).toBeVisible()

    await libraryPage.search.fill('prejudice')
    await expect(libraryPage.showing(1)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pride and Prejudice' })).toBeVisible()
    await expect(page).toHaveURL(/q=prejudice/)

    await libraryPage.search.fill('  AUSTEN ')
    await expect(libraryPage.showing(1)).toBeVisible()

    await libraryPage.clearButton.click()
    await expect(libraryPage.search).toHaveValue('')
    await expect(libraryPage.showing(5)).toBeVisible()
  })

  test('keeps every letter when typed one key at a time with no delay', async ({ page, libraryPage, siteNav }) => {
    await libraryPage.goto()
    await libraryPage.typeSearch('pride')
    await expect(libraryPage.search).toHaveValue('pride')
    await expect(page).toHaveURL(/[?&]q=pride(&|$)/)
    await expect(libraryPage.showing(1)).toBeVisible()

    const nav = await siteNav.open()
    await nav.getByRole('link', { name: 'All books' }).click()
    await expect(page).toHaveURL('/library')
    await expect(libraryPage.search).toHaveValue('')
    await expect(libraryPage.showing(5)).toBeVisible()
  })

  test('filter chips are single-select and combine with search', async ({ page, libraryPage }) => {
    await libraryPage.goto()
    const audio = libraryPage.filter('Has audiobook')
    await audio.click()
    await expect(audio).toHaveAttribute('aria-pressed', 'true')
    await expect(libraryPage.filter('All', true)).toHaveAttribute('aria-pressed', 'false')
    await expect(libraryPage.showing(1)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pride and Prejudice' })).toHaveCount(0)

    await libraryPage.search.fill('prophet')
    await expect(libraryPage.showing(1)).toBeVisible()

    await libraryPage.filter('The Inner Path').click()
    await expect(page.getByText('No results for “prophet”. Try another word.')).toBeVisible()

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(libraryPage.search).toHaveValue('')
    await expect(page).toHaveURL('/library')
    await expect(libraryPage.showing(5)).toBeVisible()
  })
})

test.describe('Site navigation', () => {
  test('site navigation lists collections and featured series', async ({ page, libraryPage, siteNav }) => {
    await libraryPage.goto()
    const nav = await siteNav.open()
    await expect(nav.getByRole('link', { name: 'All books' })).toBeVisible()
    await expect(nav.getByRole('link', { name: /^The Inner Path/ })).toHaveAttribute('href', '/library/inner-path')
    await expect(nav.getByRole('link', { name: /^Jane Austen/ })).toBeVisible()
    await nav.getByRole('link', { name: /^Jane Austen/ }).click()
    await expect(page).toHaveURL('/library/jane-austen')
    await expect(page.getByRole('heading', { level: 1, name: 'Jane Austen' })).toBeVisible()
    await expectAccessible(page)
  })

  test('the theme starts dark, switches to light and remembers it', async ({ page, libraryPage }) => {
    await libraryPage.goto()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByRole('button', { name: 'Light theme' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await expect(page.getByRole('button', { name: 'Dark theme' })).toBeVisible()
  })

  test('Ctrl+K searches books, series and chapters', async ({ page, libraryPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A keyboard shortcut; one browser is enough.')
    await libraryPage.goto()
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search books, series and chapters' })
    await expect(input).toBeFocused()
    await input.fill('chapter 61')
    await expect(page.getByRole('option', { name: /Chapter 61/ }).first()).toBeVisible()
    await input.press('Enter')
    await expect(page).toHaveURL('/read/pride-and-prejudice/chapter-61')
  })
})

test.describe('Light theme', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('folio-theme', 'light'))
  })

  test('light theme passes accessibility checks', async ({ page }) => {
    for (const path of ['/library', '/library/jane-austen', '/library/poetry-of-the-spirit/the-prophet', '/login']) {
      await page.goto(path)
      await expect(page.locator('html'), path).not.toHaveClass(/dark/)
      await expectAccessible(page)
    }
  })
})
