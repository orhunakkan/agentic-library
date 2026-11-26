import { isWide } from '../pages'
import { signedInAt } from '../support/accounts'
import { fakeSpeech, hang } from '../support/fake-speech'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'

test.describe('Home page', () => {
  test('answers 200 with its own frame: no sidebar, no app top bar, no site footer', async ({ page, homePage }) => {
    const response = await homePage.goto()
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle('Folio: read it, hear it, ask it')
    await expect(homePage.heading).toHaveText('Read it. Hear it. Ask it.')
    await expect(page.getByRole('complementary', { name: 'Site navigation' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Browse the library' })).toHaveCount(0)
    await expect(page.locator('main#main')).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)
  })

  test('describes itself to search engines and share cards', { tag: '@http' }, async ({ request }) => {
    const html = await (await request.get('/')).text()
    expect(html).toMatch(/<meta name="description" content="Folio is a calm place to read on any screen\./)
    for (const tag of [
      '<meta property="og:title" content="Folio: read it, hear it, ask it"/>',
      '<meta property="og:type" content="website"/>',
      '<meta property="og:image" content="/og/library.png"/>',
      '<link rel="canonical" href="/"/>',
    ])
      expect(html).toContain(tag)
  })

  test('signed out: Sign in and Start reading free; the sections are linked from 760px', async ({ page, homePage }) => {
    await homePage.goto()
    const signIn = homePage.header.getByRole('link', { name: 'Sign in' })
    await expect(signIn).toHaveAttribute('href', '/login?next=%2Flibrary')
    await expect(homePage.header.getByRole('link', { name: 'Open the library' })).toHaveCount(0)
    if (!homePage.hasSectionLinks) await expect(homePage.sections).toBeHidden()
    else await expect(homePage.sections.getByRole('link')).toHaveText(['Features', 'Questions'])
    const box = await homePage.header.getByRole('link', { name: 'Start reading free' }).boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0)

    await expect(page.getByRole('link', { name: 'Start reading free' })).toHaveCount(3)
    for (const link of await page.getByRole('link', { name: 'Start reading free' }).all())
      await expect(link).toHaveAttribute('href', '/signup')
    await homePage.header.getByRole('link', { name: 'Start reading free' }).click()
    await expect(page).toHaveURL('/signup')
    await homePage.goto()
    await signIn.click()
    await expect(page).toHaveURL(/\/login(\?next=%2Flibrary)?$/)
  })

  test('the content: hero, headings, no pricing, Storybook and the footer', async ({ page, homePage }, testInfo) => {
    test.skip(!['desktop', 'phone'].includes(testInfo.project.name), 'What is said, not where; two widths are enough.')
    await homePage.goto()
    const main = homePage.section('Read it. Hear it. Ask it.')
    await expect(main.getByText('A reading app for every kind of book')).toBeVisible()
    await expect(main.getByTestId('home-hero-free')).toHaveText('Folio is free.')
    await expect(main.getByRole('link', { name: 'See what it does' })).toHaveAttribute('href', '#features')

    const levels = await page
      .locator('main :is(h1, h2, h3, h4, h5, h6)')
      .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))))
    expect(levels[0]).toBe(1)
    expect(levels.filter((l) => l === 1)).toHaveLength(1)
    for (const [i, level] of levels.entries())
      if (i) expect(level, `heading ${i}`).toBeLessThanOrEqual((levels[i - 1] ?? 1) + 1)
    const features = homePage.section('One app for reading, listening and remembering.')
    await expect(features.getByRole('heading', { level: 3 }).first()).toHaveText('Press play on any page.')
    await expect(features.getByRole('heading', { level: 3 }).nth(1)).toHaveText(
      'Questions that can’t spoil the ending.',
    )

    await expect(page.locator('#pricing')).toHaveCount(0)
    await expect(page.getByRole('main')).not.toContainText(/\$\d|\bPro\b/)
    await expect(homePage.section('Questions').locator('summary')).toHaveText([
      'Do I need an account to read?',
      'What does Ask the book cost?',
      'Are my own books private?',
      'Which voices does Read aloud use?',
    ])

    const storybook = homePage.section('Storybook, for bedtime.')
    await expect(storybook).toContainText('In the works')
    await expect(storybook.getByRole('link')).toHaveCount(0)
    await expect(storybook.getByRole('button')).toHaveCount(0)

    const footer = homePage.footer
    await expect(footer.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    await expect(footer.getByTestId('home-footer-link')).toHaveText(['The library', 'Privacy', 'Terms', 'Sign in'])
    await expect(footer).toContainText('© 2026 Orhun Akkan')
    await expect(footer).toContainText('Books are in the public domain or shared under open licences')
    await expect(footer.getByRole('link', { name: 'The library' })).toHaveAttribute('href', '/library')
    await expect(footer.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Flibrary')
  })

  test('the reader preview is hidden from screen readers, its caption isn’t, and Ask goes under the page below 900px', async ({
    page,
    homePage,
  }) => {
    await homePage.goto()
    const figure = page.getByRole('figure')
    await expect(figure.first()).toContainText('Reading aloud marks each sentence as it’s spoken.')
    const drawing = page.locator('figure > [aria-hidden="true"]').first()
    await expect(drawing).toContainText('It is a truth universally acknowledged')
    await expect(drawing).toContainText('Using pages up to Ch. 1 · p. 1')
    await expect(drawing.locator('img')).toHaveAttribute('src', '/home/pride-and-prejudice.jpg')
    await expect.poll(() => drawing.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64)
    const pageText = await drawing.locator('.font-serif').boundingBox()
    const ask = await drawing.getByText('Ask this book').boundingBox()
    if (isWide(page)) expect(ask?.x ?? 0).toBeGreaterThan((pageText?.x ?? 0) + (pageText?.width ?? 0) - 1)
    else expect(ask?.y ?? 0).toBeGreaterThan((pageText?.y ?? 0) + (pageText?.height ?? 0) - 1)
  })

  test('See what it does moves focus and the view to the features', async ({ page, homePage }) => {
    await homePage.goto()
    await page.getByRole('main').getByRole('link', { name: 'See what it does' }).click()
    await expect(page).toHaveURL(/#features$/)
    const features = page.locator('#features')
    await expect(features).toBeFocused()
    await expect(features).toBeInViewport()
  })

  test('a question opens and closes from the keyboard', async ({ page, homePage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard alone, on a desktop browser.')
    await homePage.goto()
    const faq = homePage.section('Questions')
    const question = faq.locator('details').first()
    const summary = question.locator('summary')
    await expect(summary).toHaveText('Do I need an account to read?')
    await expect(question).not.toHaveAttribute('open')
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(question).toHaveAttribute('open')
    await expect(faq).toContainText('The whole library and read aloud are open to everyone.')
    await page.keyboard.press('Space')
    await expect(question).not.toHaveAttribute('open')
  })

  test('signed in: Open the library replaces Sign in, and Start reading free goes to My books', async ({
    page,
    homePage,
  }) => {
    await signedInAt(page, '/')
    await expect(page).toHaveURL('/')
    await expect(homePage.header.getByRole('link', { name: 'Open the library' })).toHaveAttribute('href', '/library')
    await expect(page.getByRole('link', { name: 'Start reading free' })).toHaveCount(2)
    for (const link of await page.getByRole('link', { name: 'Start reading free' }).all())
      await expect(link).toHaveAttribute('href', '/account/books')
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0)
    await expect(page.getByText('Already have an account?')).toHaveCount(0)
    await expectAccessible(page)
  })

  test('the skip link goes to the page’s main content', async ({ page, homePage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard alone, on a desktop browser.')
    await homePage.goto()
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await expect(skip).toHaveAttribute('href', '#main')
  })
})

test.describe('Home page, across the app', () => {
  test('reading aloud carries on across a visit to the home page, reached from the app’s footer', async ({
    page,
    homePage,
  }) => {
    await fakeSpeech(page)
    await page.goto('/library/jane-austen/pride-and-prejudice')
    await hang(page)
    await page.getByRole('button', { name: 'Read aloud', exact: true }).click()
    const dock = page.getByRole('region', { name: 'Read aloud' })
    await expect(dock).toBeVisible()
    await page.getByRole('contentinfo').getByRole('link', { name: 'About Folio' }).click()
    await expect(page).toHaveURL('/')
    await expect(homePage.heading).toHaveText('Read it. Hear it. Ask it.')
    await expect(dock).toBeVisible()
    await expect(dock).toContainText('Pride and Prejudice')
    await expect(dock.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    expect((await dock.boundingBox())?.x ?? -1).toBeLessThanOrEqual(1)
  })
})

test.describe('Home page without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('renders whole, its questions open, and its links work, the closing one to sign up', async ({
    page,
    homePage,
  }) => {
    await homePage.goto()
    await expect(homePage.heading).toHaveText('Read it. Hear it. Ask it.')
    for (const name of ['One app for reading, listening and remembering.', 'Storybook, for bedtime.', 'Questions'])
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
    await expectNoSideways(page)
    const question = page.locator('#faq details').nth(1)
    await question.locator('summary').click()
    await expect(question).toHaveAttribute('open')
    const closing = homePage.section('Open a book. Press play.')
    await expect(closing).toContainText('Bring your own books, free.')
    await expect(closing).toContainText('Already have an account? Sign in')
    await closing.getByRole('link', { name: 'Start reading free' }).click()
    await expect(page).toHaveURL('/signup')
  })
})
