import { expect, expectAccessible, test } from '../support/fixtures'

test.describe('Book page', () => {
  test('paged book: hero, facts, contents and back link to its collection', async ({ page, bookPage }) => {
    await bookPage.goto('inner-path', 'confessions-of-al-ghazzali')
    await expect(page.getByRole('heading', { level: 1, name: 'The Confessions of Al-Ghazzali' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'The Inner Path' }).first()).toHaveAttribute(
      'href',
      '/library/inner-path',
    )
    await expect(bookPage.startReading).toHaveAttribute('href', '/read/confessions-of-al-ghazzali/7')
    await expect(bookPage.listenButton).toHaveCount(0)
    await expect(page.getByText('Chapters')).toBeVisible()
    const toc = page.getByRole('region', { name: 'Contents' }).getByRole('listitem')
    await expect(toc).toHaveCount(9)
    await expect(toc.first()).toContainText('01')
    await expect(page.getByRole('heading', { name: 'More from this series' })).toHaveCount(0)
    await expectAccessible(page)
  })

  test('chapter book: opens from its cover, credits its source, back to the Library, and Start reading opens the first chapter', async ({
    page,
    libraryPage,
    bookPage,
  }) => {
    await libraryPage.goto()
    await libraryPage.shelf('jane-austen').locator('li').getByRole('link', { name: 'Pride and Prejudice' }).click()
    await expect(page).toHaveURL('/library/jane-austen/pride-and-prejudice')
    await expect(page.getByRole('heading', { level: 1, name: 'Pride and Prejudice' })).toBeVisible()
    await expect(page.getByText(/Standard Ebooks/).first()).toBeVisible()
    await expect(page.getByText(/Public domain \(CC0 edition\)/)).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: 'Library', exact: true })).toHaveAttribute(
      'href',
      '/library',
    )
    await bookPage.startReading.click()
    await expect(page).toHaveURL('/read/pride-and-prejudice/chapter-1')
    await expect(page.getByRole('heading', { level: 1, name: 'Chapter 1' })).toBeVisible()
  })

  test('in-book search filters chapter titles and searches the text, code included', async ({ page, bookPage }) => {
    await bookPage.goto('code-fixtures', 'fixture-code-book')
    const search = bookPage.search
    await search.fill('tables')
    await expect(
      page.getByRole('region', { name: 'Contents' }).getByRole('link', { name: /Lists and Tables/ }),
    ).toBeVisible()
    await search.fill('qqqq')
    await expect(page.getByText('No chapters match “qqqq”.')).toBeVisible()
    await search.fill('satisfies')
    await expect(page.getByRole('heading', { name: /In the text · \d+/ })).toBeVisible()
    await expect(page.locator('mark').first()).toContainText(/satisfies/i)
  })

  test('Audiobook tab lists episodes; Listen starts the first one', async ({ page, audioPlayer, bookPage }) => {
    await bookPage.goto('poetry-of-the-spirit', 'the-prophet')
    await expect(page.getByText('Audiobook', { exact: true }).first()).toBeVisible()
    await bookPage.listenButton.click()
    await expect(bookPage.tab('Audiobook')).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/tab=audio/)
    const first = page.getByRole('button', { name: /^(Play|Pause) The Coming of the Ship/ })
    await expect(first).toHaveAttribute('aria-pressed', 'true')
    await expect(audioPlayer.dock).toBeVisible()
    await expectAccessible(page)

    await expect(page.getByRole('button', { name: 'Pause The Coming of the Ship' })).toBeVisible()
    await page.getByRole('button', { name: 'Pause The Coming of the Ship' }).click()
    await expect(audioPlayer.playEpisode('The Coming of the Ship')).toBeVisible()

    await bookPage.tab('Text').click()
    await expect(page.getByRole('region', { name: 'Contents' })).toBeVisible()
  })

  test('unknown book or wrong series is a 404', { tag: '@http' }, async ({ request }) => {
    const res = await request.get('/library/code-fixtures/pride-and-prejudice')
    expect(res.status()).toBe(404)
    expect(await res.text()).toContain('This page isn’t on our shelves')
  })

  test('the books that left the library answer 404, and so do their old /works links', { tag: '@http' }, async ({
    request,
  }) => {
    for (const path of [
      '/library/javascript/eloquent-javascript',
      '/library/typescript/concise-typescript-book',
      '/read/eloquent-javascript/introduction',
      '/read/concise-typescript-book/type-predicates',
    ])
      expect((await request.get(path)).status(), path).toBe(404)
    expect((await request.get('/works/javascript/eloquent-javascript')).status()).toBe(404)
  })
})
