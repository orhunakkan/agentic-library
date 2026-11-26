import { createUser } from '../support/accounts'
import { articleUrl } from '../support/articles-stub'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { hydrated } from '../support/settle'

const TITLE = 'The Quiet Return of the Night Train'
const MARKERS = ['NAV-MARKER', 'ADS-MARKER', 'RELATED-MARKER', 'COMMENTS-MARKER', 'FOOTER-MARKER', 'TRACKER-MARKER']

test.describe('Articles', () => {
  test('save an article, read it with its pictures, highlight it and find the original', async ({
    page,
    baseURL,
    siteNav,
    articlesPage,
    readerPage,
  }) => {
    const url = articleUrl((baseURL ?? '').replace('localhost', '127.0.0.1'), 'news')
    await createUser(page.request, { signedIn: true })
    await page.goto('/library')
    await hydrated(page)

    const nav = await siteNav.open()
    await nav.getByRole('link', { name: 'Articles' }).click()
    await expect(articlesPage.title).toBeVisible()
    await hydrated(page)
    await expect(articlesPage.empty).toBeVisible()
    await expect(articlesPage.count).toHaveText('0 of 500 articles')

    await articlesPage.save('http://localhost/x')
    await expect(articlesPage.error).toHaveText('Folio can’t open addresses on a private network.')

    await articlesPage.save(url)
    await expect(articlesPage.progress).toHaveText(/^Saved\./, { timeout: 15_000 })
    const card = articlesPage.card(TITLE)
    await expect(card).toContainText(/From 127\.0\.0\.1 · \d+ min read · saved just now/)
    await expect(articlesPage.count).toHaveText('1 of 500 articles')
    await expectAccessible(page)
    await expectNoSideways(page)
    const id = (await card.getAttribute('data-key')) ?? ''

    await articlesPage.readNew.click()
    const content = page.locator('#reader-content')
    await expect(content).toContainText('At ten past nine in the evening the platform')
    for (const marker of MARKERS) await expect(content).not.toContainText(marker)
    const picture = content.getByRole('img', { name: 'A sleeper train waiting at a platform at dusk' })
    await expect(picture).toBeVisible()
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(800)
    await expect(page.getByRole('button', { name: 'Run JavaScript example' })).toHaveCount(1)

    await readerPage.select(readerPage.paragraph())
    const highlighted = page.waitForResponse((r) => r.url().endsWith('/account/highlights/new'))
    await readerPage.button('Highlight').click()
    expect((await highlighted).status()).toBe(201)

    await page.goto(`/account/books/${id}`)
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.getByText('Article', { exact: true })).toBeVisible()
    await expect(page.getByTestId('article-line')).toContainText(/From 127\.0\.0\.1 · saved .+ · \d+ min read/)
    const original = page.getByTestId('article-original')
    await expect(original).toHaveAttribute('href', url)
    await expect(original).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    await expect(original).toHaveAttribute('target', '_blank')
    await expect(page.getByTestId('private-book-fact').filter({ hasText: 'Pictures' })).toContainText('2')
    await expect(page.getByTestId('book-lookup-open')).toHaveCount(0)
    await expectAccessible(page)
    await expectNoSideways(page)
  })

  test('an address saved already, the library’s Articles row and filter, and Delete', async ({
    page,
    baseURL,
    articlesPage,
    libraryPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The page’s second journey; one layout is enough.')
    const url = articleUrl((baseURL ?? '').replace('localhost', '127.0.0.1'), 'news')
    await createUser(page.request, { signedIn: true })
    await articlesPage.goto()
    await hydrated(page)
    await articlesPage.save(url)
    await expect(articlesPage.progress).toHaveText(/^Saved\./, { timeout: 15_000 })

    await articlesPage.goto(url)
    await hydrated(page)
    await expect(articlesPage.address).toHaveValue(url)
    await expect(articlesPage.cards).toHaveCount(1)
    await articlesPage.saveButton.click()
    await expect(articlesPage.error).toHaveText('You’ve already saved this article. Read it')
    await expect(articlesPage.openExisting).toHaveAttribute('href', /^\/read\/u-[0-9a-f-]{36}\//)

    await libraryPage.goto()
    const row = libraryPage.shelfRow('Articles')
    await expect(row.getByText(TITLE)).toBeVisible()
    await libraryPage.goto('?filter=articles')
    await expect(libraryPage.shelves).toHaveCount(1)
    await expect(libraryPage.showing(1)).toBeVisible()
    await expect(libraryPage.filter('Articles', true)).toHaveAttribute('aria-pressed', 'true')

    await articlesPage.goto()
    await articlesPage.remove(TITLE)
    await expect(page.getByTestId('articles-deleted')).toHaveText('Article deleted.')
    await expect(articlesPage.empty).toBeVisible()
  })

  test('an article over the text cap is refused with the cap, and isn’t kept', async ({
    page,
    baseURL,
    articlesPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A refusal on the page; one layout is enough.')
    const url = articleUrl((baseURL ?? '').replace('localhost', '127.0.0.1'), 'long')
    await createUser(page.request, { signedIn: true })
    await articlesPage.goto()
    await hydrated(page)
    await articlesPage.save(url)
    await expect(articlesPage.error).toHaveText('This article is over 1 MB of text, the most an article can hold.', {
      timeout: 30_000,
    })
    await articlesPage.goto()
    await expect(articlesPage.empty).toBeVisible()
    await expect(articlesPage.count).toHaveText('0 of 500 articles')
  })
})
