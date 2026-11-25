import type { Page } from '@playwright/test'
import { press } from '../pages'
import { chooseModel, createUser, saveKey, validKey } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, hydrated, test } from '../support/fixtures'
import { openAiKey } from '../support/openai-stub'
import { STUB_TERMS } from '../support/wikimedia-stub'

const PAGE = '/read/pride-and-prejudice/chapter-1'

async function reader(page: Page, key: string | null = '0000') {
  const user = await createUser(page.request, { signedIn: true })
  if (key) await saveKey(page, validKey(key))
  await page.goto(PAGE)
  return user
}

test.describe('Look up', () => {
  test('a word: its dictionary entry, then its Wikipedia summary, and Esc goes back to the page', async ({
    page,
    readerPage,
  }) => {
    await reader(page, null)
    const lookup = await readerPage.lookUp('chaise')
    await expect(lookup.getByRole('heading', { name: 'chaise' })).toBeFocused()
    await expect(lookup.getByRole('heading', { name: 'Noun' })).toBeVisible()
    await expect(lookup.getByText(/^An open, horse-drawn carriage/)).toBeVisible()
    await expect(lookup.getByText('From Wiktionary · CC BY-SA')).toBeVisible()
    const wiktionary = lookup.getByRole('link', { name: 'Open in Wiktionary' })
    await expect(wiktionary).toHaveAttribute('href', 'http://127.0.0.1:3100/test-wikimedia/wiktionary/wiki/chaise')
    await expect(wiktionary).toHaveAttribute('rel', 'noopener noreferrer')
    await expectAccessible(page)

    await press(page, lookup.getByRole('tab', { name: 'Wikipedia' }))
    await expect(lookup.getByRole('heading', { name: 'Chaise', exact: true })).toBeVisible()
    await expect(lookup.getByText('Two-wheeled horse-drawn carriage')).toBeVisible()
    await expect(lookup.getByRole('link', { name: 'Read on Wikipedia' })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Chaise',
    )
    await expectAccessible(page)

    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(PAGE)
    await page.keyboard.press('Escape')
    await expect(lookup).toBeHidden()
    await expect(readerPage.content).toBeFocused()
    await expectNoSideways(page)
  })

  test('signed out it offers Sign in; signed in, a form of another word, Translate without a key, and Retry', async ({
    page,
    readerPage,
  }) => {
    await page.goto(PAGE)
    let lookup = await readerPage.lookUp('chaise')
    await expect(lookup.getByText('Sign in to look up words and translate passages.')).toBeVisible()
    await expect(lookup.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent(PAGE)}`,
    )
    await page.keyboard.press('Escape')

    await reader(page, null)
    lookup = await readerPage.lookUp('acknowledged')
    await expect(lookup.getByRole('heading', { name: 'Adjective' })).toBeVisible()
    await press(page, lookup.getByRole('button', { name: 'Look up “acknowledge”' }))
    lookup = readerPage.lookupCard('acknowledge')
    await expect(lookup.getByRole('heading', { name: 'acknowledge', exact: true })).toBeVisible()
    await expect(lookup.getByText(/^To admit the knowledge of/)).toBeVisible()
    await press(page, lookup.getByRole('tab', { name: 'Translate' }))
    await expect(lookup.getByRole('link', { name: 'Add a key' })).toHaveAttribute('href', '/account/api-keys')
    await page.keyboard.press('Escape')

    lookup = await readerPage.lookUp(STUB_TERMS.busy)
    await expect(lookup.getByText('Wiktionary is busy. Try again in a moment.')).toBeVisible()
    const again = page.waitForRequest((r) => r.url().endsWith('/account/lookup/word'))
    await press(page, lookup.getByRole('button', { name: 'Retry' }))
    await again
    await expect(lookup.getByText('Wiktionary is busy. Try again in a moment.')).toBeVisible()
  })
})

test.describe('Translate', () => {
  test('a word in its sentence, the language kept on the device, then a passage, quoted', async ({
    page,
    readerPage,
  }) => {
    await reader(page)
    let lookup = await readerPage.lookUp('chaise')
    await press(page, lookup.getByRole('tab', { name: 'Translate' }))
    await expect(lookup.getByText('Choose a language to translate into.')).toBeVisible()
    await lookup.getByLabel('Translate to').selectOption({ label: 'Turkish · Türkçe' })
    await expect(lookup.getByText('[tr] chaise')).toBeVisible()
    await expect(lookup.getByText('Sense: “Why,')).toBeVisible()
    await expect(lookup.getByText('Translated by Claude Opus 5.5 with your Anthropic key.')).toBeVisible()
    await expect(lookup.locator('[lang="tr"]')).toHaveAttribute('dir', 'auto')

    await page.reload()
    lookup = await readerPage.lookUp('chaise')
    await press(page, lookup.getByRole('tab', { name: 'Translate' }))
    await expect(lookup.getByLabel('Translate to')).toHaveValue('tr')
    await expect(lookup.getByText('[tr] chaise')).toBeVisible()
    await page.keyboard.press('Escape')

    await readerPage.paragraph().scrollIntoViewIfNeeded()
    await readerPage.select(readerPage.paragraph())
    await expect(readerPage.button('Look up')).toBeHidden()
    await press(page, readerPage.button('Translate'))
    lookup = readerPage.lookupCard('Translate passage')
    await expect(lookup).toBeVisible()
    await expect(lookup.locator('blockquote')).toHaveText(/^It is a truth universally acknowledged/)
    await lookup.getByLabel('Translate to').selectOption('de')
    await expect(lookup.getByText(/^\[de\] It is a truth universally acknowledged/)).toBeVisible()
    await expectAccessible(page)
  })
})

test.describe('Translate on a GPT model', () => {
  test('translates through OpenAI and credits the GPT model and the OpenAI key', async ({ page, readerPage }) => {
    await createUser(page.request, { signedIn: true })
    await saveKey(page, openAiKey(), 'openai')
    await chooseModel(page, 'gpt-6.1-terra')
    await page.goto(PAGE)
    const lookup = await readerPage.lookUp('chaise')
    await press(page, lookup.getByRole('tab', { name: 'Translate' }))
    await expect(
      lookup.getByText('The text and the sentence around it go to OpenAI with your key. The book doesn’t.'),
    ).toBeVisible()
    await lookup.getByLabel('Translate to').selectOption({ label: 'Turkish · Türkçe' })
    await expect(lookup.getByText('[tr] chaise')).toBeVisible()
    await expect(lookup.getByText('Translated by GPT-6.1 Terra with your OpenAI key.')).toBeVisible()
    await expect(lookup.getByText('Uses Ask with your OpenAI key.')).toBeVisible()
    await expectAccessible(page)
  })

  test('without an OpenAI key it asks for one', async ({ page, readerPage }) => {
    await reader(page)
    await chooseModel(page, 'gpt-6-luna')
    await page.goto(PAGE)
    const lookup = await readerPage.lookUp('chaise')
    await press(page, lookup.getByRole('tab', { name: 'Translate' }))
    await expect(lookup.getByText('Translating uses your own OpenAI key.')).toBeVisible()
    await expect(lookup.getByRole('link', { name: 'Add a key' })).toHaveAttribute('href', '/account/api-keys')
  })
})

test.describe('Explain in context', () => {
  test('asks Ask what the word means in its sentence', async ({ page, readerPage }) => {
    await reader(page)
    const lookup = await readerPage.lookUp('chaise')
    await press(page, lookup.getByRole('button', { name: 'Explain in context' }))
    await expect(lookup).toBeHidden()
    const ask = page
      .getByRole('complementary', { name: 'Ask this book' })
      .or(page.getByRole('dialog', { name: 'Ask this book' }))
    await expect(ask.getByText('What does “chaise” mean here?')).toBeVisible()
    await expect(ask.getByText(/the passage you selected\. Request: define\./)).toBeVisible()
  })
})

test.describe('Where Look up is not offered', () => {
  test('inside code, over 1,000 characters, and embedded', async ({ page, readerPage }) => {
    await readerPage.goto('fixture-code-book', 'lists-and-tables')
    await hydrated(page)
    await readerPage.select(readerPage.content.locator('pre').first())
    await expect(readerPage.button('Explain')).toBeVisible()
    await expect(readerPage.button('Look up')).toBeHidden()
    await expect(readerPage.button('Translate')).toBeHidden()

    await page.goto(PAGE)
    await hydrated(page)
    await readerPage.select(page.locator('#reader-content [data-highlight-root]'))
    await expect(readerPage.button('Explain')).toBeVisible()
    await expect(readerPage.button('Translate')).toBeHidden()

    await page.goto(`${PAGE}?iframe=true`)
    await readerPage.selectWord('chaise')
    await expect(page.getByText('Ask about this')).toHaveCount(1)
    await expect(readerPage.button('Look up')).toHaveCount(0)
  })

  test('the six buttons fit a 360px screen', async ({ page, readerPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'a viewport set by hand, once')
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto(PAGE)
    await readerPage.selectWord('acknowledged')
    await expect(readerPage.button('Look up')).toBeVisible()
    for (const name of ['Highlight', 'Note', 'Ask about this', 'Explain', 'Look up']) {
      const box = await readerPage.button(name).boundingBox()
      expect(box, name).not.toBeNull()
      expect(box?.x ?? -1, name).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual(360)
    }
    await expectNoSideways(page)
  })
})
