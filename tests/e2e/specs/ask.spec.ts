import type { Page } from '@playwright/test'
import { isWide, press, ReaderPage } from '../pages'
import { chooseModel, createUser, saveKey, signedInAt, validKey } from '../support/accounts'
import { STUB_KEYS } from '../support/anthropic-stub'
import { fakeSpeech } from '../support/fake-speech'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { importViaApi } from '../support/imports'
import { openAiKey, STUB_OPENAI_KEYS } from '../support/openai-stub'

const PAGE = '/read/pride-and-prejudice/chapter-6/3'
const QUESTION = 'Why is Mr. Darcy so proud at the assembly?'

async function readerWithKey(page: Page, ending = '0000', at = PAGE) {
  const user = await createUser(page.request, { signedIn: true })
  await saveKey(page, validKey(ending))
  await page.goto(at)
  return user
}

test.describe('Ask the book', () => {
  test('signed out: says why, Sign in comes back to this page, and Explain on a selection sends nothing', async ({
    page,
    readerPage,
  }) => {
    const asked: string[] = []
    page.on('request', (r) => {
      if (/^\/read\/[^/]+\/ask$/.test(new URL(r.url()).pathname)) asked.push(r.url())
    })
    await page.goto(PAGE)
    const ask = await readerPage.ask.open()
    await expect(ask.getByText('Sign in and add an Anthropic API key to ask questions about this book.')).toBeVisible()
    await expect(ask.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(PAGE)}`,
    )
    await expectAccessible(page)

    await page.reload()
    await page
      .locator('#reader-content p')
      .first()
      .evaluate((p) => document.getSelection()?.selectAllChildren(p))
    await press(page, readerPage.button('Explain'))
    await expect(
      readerPage.ask.panel.getByText('Sign in and add an Anthropic API key to ask questions about this book.'),
    ).toBeVisible()
    expect(asked).toEqual([])
  })

  test('signed in without a key: links to the API keys page', async ({ page, readerPage }) => {
    await signedInAt(page, PAGE)
    const ask = await readerPage.ask.open()
    await expect(ask.getByText('Add an Anthropic API key to ask questions.')).toBeVisible()
    await expect(ask.getByRole('link', { name: 'Add an API key' })).toHaveAttribute('href', '/account/api-keys')
  })

  test('streams an answer with a chip that opens the cited page, and keeps the thread', async ({
    page,
    readerPage,
  }) => {
    await readerWithKey(page)
    const ask = await readerPage.ask.open()
    await expect(ask.getByText('Using pages up to Ch. 6 · p. 3')).toBeVisible()
    await expect(ask.getByRole('link', { name: 'Claude Opus 5.5' })).toHaveAttribute('href', '/account/api-keys#model')
    await expect(
      ask.getByText('Your question and the book’s text are sent to Anthropic with your API key.'),
    ).toBeVisible()

    await readerPage.ask.ask(QUESTION)
    await expect(ask.getByText(QUESTION)).toBeVisible()
    await expect(ask.getByText(/I can see \d+ pages of the book\./)).toBeVisible()
    await expect(ask.locator('pre', { hasText: 'const answer = 42' })).toBeVisible()
    const chip = ask.getByRole('link', { name: 'Source: Ch. 6 · p. 3' })
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute('href', PAGE)
    await expect(ask.getByRole('button', { name: 'Copy' })).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)

    await readerPage.goto('pride-and-prejudice', 'chapter-6', 4)
    const again = isWide(page) ? readerPage.ask.panel : await readerPage.ask.open()
    await expect(again.getByText(QUESTION)).toBeVisible()
    await again.getByRole('link', { name: 'Source: Ch. 6 · p. 3' }).click()
    await expect(page).toHaveURL(PAGE)
  })

  test('the scope follows the page, and the whole-book switch changes what is sent', async ({ page, readerPage }) => {
    await readerWithKey(page)
    const ask = await readerPage.ask.open()
    await readerPage.ask.ask('How far am I?')
    const scoped = Number((await ask.getByText(/I can see \d+ pages/).textContent())?.match(/\d+/)?.[0])
    expect(scoped).toBeLessThan(216)
    await expect(ask.getByRole('button', { name: 'Copy' })).toBeVisible()

    await ask.getByRole('switch', { name: 'Use the whole book' }).click()
    await expect(ask.getByText('Using the whole book (may include spoilers)')).toBeVisible()
    await readerPage.ask.ask('And now?')
    await expect(ask.getByText('I can see 216 pages of the book.')).toBeVisible()

    await page.reload()
    const again = isWide(page) ? readerPage.ask.panel : await readerPage.ask.open()
    await expect(again.getByRole('switch', { name: 'Use the whole book' })).toBeChecked()
  })

  test('Stop keeps what arrived and marks it; Clear empties the thread', async ({ page, readerPage }) => {
    await readerWithKey(page, STUB_KEYS.slow)
    const ask = await readerPage.ask.open()
    await readerPage.ask.ask(QUESTION)
    await expect(ask.getByText(/word2/)).toBeVisible()
    await ask.getByRole('button', { name: 'Stop the answer' }).click()
    await expect(ask.getByText('Stopped')).toBeVisible()
    await expect(ask.getByText(/word1/)).toBeVisible()
    await expect(ask.getByRole('button', { name: 'Send question' })).toBeVisible()

    await ask.getByRole('button', { name: 'Clear' }).click()
    await expect(ask.getByText(QUESTION)).toHaveCount(0)
    await expect(ask.getByRole('button', { name: 'Summarise this chapter so far' })).toBeVisible()
  })

  test('shows a failure as plain words, with Retry where trying again can help, asking the same way again', async ({
    page,
    readerPage,
  }) => {
    await readerWithKey(page, STUB_KEYS.overloaded)
    const ask = await readerPage.ask.open()
    await ask.getByRole('button', { name: 'Summarise this chapter so far' }).click()
    await expect(ask.getByRole('alert')).toContainText('Anthropic is busy. Try again in a moment.')
    await saveKey(page)
    await ask.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
    await expect(ask.getByText('Summarise this chapter so far.')).toBeVisible()
    await expect(ask.getByText(/Request: summary\./)).toBeVisible()
    await expect(ask.getByRole('button', { name: 'Copy' })).toBeVisible()

    await saveKey(page, validKey(STUB_KEYS.rejected))
    await readerPage.ask.ask(QUESTION)
    await expect(ask.getByRole('alert')).toContainText('Anthropic rejected your API key.')
    await expect(ask.getByRole('alert').getByRole('button', { name: 'Retry' })).toHaveCount(0)
  })

  test('suggested questions: "Remind me…" is left to finish, a summary asks at once, then Quick questions', async ({
    page,
    readerPage,
  }) => {
    await readerWithKey(page)
    const ask = await readerPage.ask.open()
    await ask.getByRole('button', { name: 'Remind me what the book has said about …' }).click()
    const box = ask.getByRole('textbox', { name: 'Your question about this book' })
    await expect(box).toHaveValue('Remind me what the book has said about ')
    await expect(box).toBeFocused()
    await box.fill('')
    await expect(ask.getByRole('button', { name: 'Recap the book so far' })).toBeVisible()
    await ask.getByRole('button', { name: 'Summarise this chapter so far' }).click()
    await expect(ask.getByText('Summarise this chapter so far.')).toBeVisible()
    await expect(ask.getByText(/I can see \d+ pages of the book\. Request: summary\./)).toBeVisible()

    await expect(ask.getByRole('button', { name: 'Copy' })).toBeVisible()
    const quick = ask.getByRole('group', { name: 'Quick questions' })
    await expect(quick.getByRole('button')).toHaveText(['Summarise chapter', 'Recap so far', 'Quiz me', 'Flashcards'])
    await expectAccessible(page)
    await quick.getByRole('button', { name: 'Recap so far' }).click()
    await expect(ask.getByText('Recap the book so far.')).toBeVisible()
    await expect(ask.getByText(/Request: recap\./)).toBeVisible()
  })

  test('a private book: its owner can ask, and the chip opens its page', async ({ page, baseURL, readerPage }) => {
    await createUser(page.request, { signedIn: true })
    const book = await importViaApi(page.request, baseURL ?? '', {
      title: 'Ask Notes',
      chapters: [{ title: 'Only', text: 'Closures remember the scope they were made in.' }],
    })
    await saveKey(page)
    await page.goto(book.href)
    const ask = await readerPage.ask.open()
    await readerPage.ask.ask(QUESTION)
    await expect(ask.getByRole('link', { name: 'Source: Ch. 1 · p. 1' })).toHaveAttribute('href', book.href)
  })

  test('works with the keyboard alone; focus goes into the panel and back to the button', async ({
    page,
    readerPage,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard reading on desktop; the sheet below 900px is Base UI’s.')
    await readerWithKey(page)
    const button = page.getByRole('button', { name: 'Ask', exact: true })
    await button.focus()
    await page.keyboard.press('Enter')
    const box = readerPage.ask.panel.getByRole('textbox', { name: 'Your question about this book' })
    await expect(box).toBeFocused()
    await page.keyboard.type('First line')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('second line')
    await expect(box).toHaveValue('First line\nsecond line')
    await page.keyboard.press('ArrowLeft')
    await expect(page).toHaveURL(PAGE)
    await page.keyboard.press('Enter')
    await expect(readerPage.ask.panel.getByText(/I can see \d+ pages/)).toBeVisible()

    await readerPage.ask.panel.getByRole('button', { name: 'Close Ask this book' }).focus()
    await page.keyboard.press('Enter')
    await expect(readerPage.ask.panel).toBeHidden()
    await expect(button).toBeFocused()
    await button.press('Enter')
    await page.reload()
    await expect(readerPage.ask.panel).toBeVisible()
  })

  test('the panel is left out of embedded and fullscreen reading', async ({ page, readerPage }) => {
    await page.goto(`${PAGE}?iframe=true`)
    await expect(readerPage.ask.openButton).toBeHidden()
  })
})

test.describe('Ask about a selection', () => {
  const paragraph = (page: Page) => page.locator('#reader-content p').first()
  const chip = (page: Page) => page.getByRole('button', { name: 'Ask about this' })
  const toolbar = (page: Page) => new ReaderPage(page).button('Explain').locator('..')
  const selectFirstParagraph = (page: Page) =>
    paragraph(page).evaluate((p) => document.getSelection()?.selectAllChildren(p))

  async function expectToolbarInside(page: Page, margin = 0) {
    const box = await toolbar(page).boundingBox()
    const width = page.viewportSize()?.width ?? 0
    if (!box) throw new Error('no toolbar')
    expect(box.x).toBeGreaterThanOrEqual(margin - 0.5)
    expect(box.x + box.width).toBeLessThanOrEqual(width - margin + 0.5)
  }

  test('Explain explains the selected passage in one press', async ({ page, readerPage }) => {
    await readerWithKey(page)
    await selectFirstParagraph(page)
    await expect(readerPage.button('Explain')).toBeVisible()
    await expectToolbarInside(page)
    await press(page, readerPage.button('Explain'))

    const ask = readerPage.ask.panel
    await expect(ask.getByText('Explain this passage in plain words.')).toBeVisible()
    await expect(ask.getByText(/the passage you selected\. Request: explain\./)).toBeVisible()
    await expect(ask.getByText('Asking about')).toHaveCount(0)
    await expect(ask.getByRole('button', { name: 'Copy' })).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)
  })

  test('the toolbar fits a 360px screen, every label whole', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Sized by hand; one browser is enough.')
    await fakeSpeech(page)
    await page.setViewportSize({ width: 360, height: 780 })
    await page.goto(PAGE)
    await selectFirstParagraph(page)
    const names = ['Highlight', 'Note', 'Ask about this', 'Explain', 'Read aloud from here']
    for (const name of names) {
      const button = page.getByRole('button', { name, exact: true })
      await expect(button).toBeVisible()
      const fits = await button.evaluate((el) => el.scrollWidth <= el.clientWidth)
      expect(fits, `${name} is clipped`).toBe(true)
    }
    await expectToolbarInside(page, 8)
  })

  test('with the mouse: a chip near the selection opens Ask with the passage quoted', async ({ page, readerPage }) => {
    test.skip(!isWide(page), 'Mouse selection; touch is covered on the phone.')
    await readerWithKey(page)
    const box = await paragraph(page).boundingBox()
    if (!box) throw new Error('no paragraph')
    await page.mouse.move(box.x + 4, box.y + 8)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 4, box.y + 8, { steps: 8 })
    await page.mouse.up()
    await expect(chip(page)).toBeVisible()
    await chip(page).click()

    const ask = readerPage.ask.panel
    await expect(ask.getByText('Asking about')).toBeVisible()
    const box2 = ask.getByRole('textbox', { name: 'Your question about this book' })
    await expect(box2).toBeFocused()
    await box2.fill('What does this mean?')
    await box2.press('Enter')
    await expect(ask.getByText(/and the passage you selected/)).toBeVisible()
    await expect(ask.getByText('Asking about')).toHaveCount(0)
    await expectAccessible(page)
  })

  test('with the keyboard: Tab reaches the toolbar after the selection', async ({ page, readerPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard reading on desktop; touch is covered on the phone.')
    await readerWithKey(page)
    await page.getByRole('link', { name: 'Skip to content' }).focus()
    await page.keyboard.press('Enter')
    await expect(readerPage.content).toBeFocused()
    await paragraph(page).evaluate((p) => {
      const range = document.createRange()
      range.setStart(p.firstChild ?? p, 0)
      range.setEnd(p.firstChild ?? p, Math.min(40, p.firstChild?.textContent?.length ?? 0))
      document.getSelection()?.removeAllRanges()
      document.getSelection()?.addRange(range)
    })
    await expect(chip(page)).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Bookmark this page' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Highlight', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(chip(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(readerPage.button('Explain')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(chip(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(readerPage.ask.panel.getByText('Asking about')).toBeVisible()
    await readerPage.ask.panel.getByRole('button', { name: 'Remove the quoted passage' }).click()
    await expect(readerPage.ask.panel.getByText('Asking about')).toHaveCount(0)
  })

  test('with touch: the chip opens the sheet with the passage quoted', async ({ page, readerPage }) => {
    test.skip(isWide(page), 'Touch selection on a phone.')
    await readerWithKey(page)
    await paragraph(page).evaluate((p) => document.getSelection()?.selectAllChildren(p))
    await expect(chip(page)).toBeVisible()
    await chip(page).tap()
    const ask = readerPage.ask.panel
    await expect(ask.getByText('Asking about')).toBeVisible()
    await ask.getByRole('textbox', { name: 'Your question about this book' }).fill('What does this mean?')
    await ask.getByRole('button', { name: 'Send question' }).tap()
    await expect(ask.getByText(/and the passage you selected/)).toBeVisible()
  })

  test('never appears for a selection inside the panel, or outside the reading area', async ({
    page,
    readerPage,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'Where the toolbar shows is the same on every layout; once is enough.',
    )
    await readerWithKey(page)
    const ask = await readerPage.ask.open()
    await selectFirstParagraph(page)
    await expect(chip(page)).toBeVisible()
    await ask
      .getByText('Your question and the book’s text are sent to Anthropic with your API key.')
      .evaluate((p) => document.getSelection()?.selectAllChildren(p))
    await expect(chip(page)).toHaveCount(0)

    await selectFirstParagraph(page)
    await expect(chip(page)).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Page navigation' })
      .evaluate((nav) => document.getSelection()?.selectAllChildren(nav))
    await expect(chip(page)).toHaveCount(0)
  })
})

async function readerOnGpt(page: Page, { key = openAiKey() as string | null, anthropic = false } = {}) {
  const user = await createUser(page.request, { signedIn: true })
  if (anthropic) await saveKey(page, validKey('0000'))
  if (key) await saveKey(page, key, 'openai')
  await chooseModel(page, 'gpt-6-luna')
  await page.goto(PAGE)
  return user
}

test.describe('Ask the book on a GPT model', () => {
  test('streams an answer with no page links, names OpenAI, and turns Quiz and Flashcards off', async ({
    page,
    readerPage,
  }) => {
    await readerOnGpt(page, { anthropic: true })
    const ask = await readerPage.ask.open()
    await expect(ask.getByRole('link', { name: 'GPT-6 Luna' })).toHaveAttribute('href', '/account/api-keys#model')
    await expect(ask.getByText('Your question and the book’s text are sent to OpenAI with your API key.')).toBeVisible()
    await expect(ask.getByTestId('ask-intro')).toHaveText('Ask about what you’ve read.')
    for (const name of ['Quiz me on this chapter so far', 'Make flashcards from this chapter so far']) {
      const button = ask.getByRole('button', { name })
      await expect(button).toBeDisabled()
      await expect(button).toContainText('Quizzes and flashcards need a Claude model')
    }
    await expectAccessible(page)

    await readerPage.ask.ask(QUESTION)
    await expect(ask.getByText(/GPT can see \d+ pages of the book\./)).toBeVisible()
    await expect(ask.locator('pre', { hasText: 'const answer = 42' })).toBeVisible()
    await expect(ask.getByRole('button', { name: 'Copy' })).toBeVisible()
    await expect(ask.getByRole('link', { name: /^Source:/ })).toHaveCount(0)
    const quick = ask.getByRole('group', { name: 'Quick questions' })
    await expect(quick.getByRole('button', { name: 'Quiz me' })).toBeDisabled()
    await expect(quick.getByRole('button', { name: 'Flashcards' })).toBeDisabled()
    await expect(quick.getByRole('button', { name: 'Summarise chapter' })).toBeEnabled()
    await expectAccessible(page)
  })

  test('without an OpenAI key it asks for one, even with an Anthropic key saved', async ({ page, readerPage }) => {
    await readerOnGpt(page, { key: null, anthropic: true })
    const ask = await readerPage.ask.open()
    await expect(ask.getByText('Add an OpenAI API key to ask questions with a GPT model.')).toBeVisible()
    await expect(ask.getByRole('link', { name: 'Add an API key' })).toHaveAttribute('href', '/account/api-keys')
  })

  test('failures name OpenAI', async ({ page, readerPage }) => {
    await readerOnGpt(page, { key: openAiKey(STUB_OPENAI_KEYS.rejected) })
    const ask = await readerPage.ask.open()
    await readerPage.ask.ask(QUESTION)
    const alert = ask.getByRole('alert')
    await expect(alert).toContainText('OpenAI rejected your API key. Update it on the API keys page.')
    await expect(alert.getByRole('link', { name: 'API keys' })).toHaveAttribute('href', '/account/api-keys')
  })
})
