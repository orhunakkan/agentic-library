import type { Page } from '@playwright/test'
import { isWide } from '../pages'
import { createUser, saveKey, validKey } from '../support/accounts'
import { STUB_KEYS, STUB_RIGHT_ANSWER } from '../support/anthropic-stub'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'

const PAGE = '/read/pride-and-prejudice/chapter-6/3'
const card = (n: number) => `Stub card ${n}: what does the page say?`

async function readerWithKey(page: Page, ending = '0000') {
  await createUser(page.request, { signedIn: true })
  await saveKey(page, validKey(ending))
  await page.goto(PAGE)
}

test.describe('Quizzes and flashcards', () => {
  test('a quiz: right and wrong at once with the reason and its page, the score, a saved card, and a reload', async ({
    page,
    readerPage,
  }) => {
    await readerWithKey(page)
    const ask = await readerPage.ask.open()
    await ask.getByRole('button', { name: 'Quiz me on this chapter so far' }).click()
    await expect(ask.getByText('Quiz me on this chapter so far.')).toBeVisible()
    await expect(ask.getByText(/^5 questions on this chapter so far/)).toBeVisible()

    const first = readerPage.ask.question(1)
    await first.getByRole('button', { name: new RegExp(STUB_RIGHT_ANSWER) }).click()
    await expect(first.getByText('Right.', { exact: true })).toBeVisible()
    await expect(first.getByRole('button', { name: /Right answer/ })).toBeDisabled()

    const second = readerPage.ask.question(2)
    await second.getByRole('button', { name: /A wrong answer 2a/ }).click()
    await expect(second.getByText(/^Not quite\. The answer is [A-D]\.$/)).toBeVisible()
    await expect(second.getByRole('button', { name: /A wrong answer 2a.*Your answer/ })).toBeVisible()
    await expect(second.getByRole('button', { name: new RegExp(`${STUB_RIGHT_ANSWER}.*Right answer`) })).toBeVisible()
    await expect(second.getByText('Why:')).toBeVisible()
    await expect(second.getByText('The page says so (2).')).toBeVisible()
    await expect(second.getByRole('link', { name: 'Source: Ch. 6 · p. 3' })).toBeVisible()

    for (const n of [3, 4, 5]) {
      await readerPage.ask
        .question(n)
        .getByRole('button', { name: new RegExp(STUB_RIGHT_ANSWER) })
        .click()
    }
    await expect(ask.getByText('You got 4 of 5 right.')).toBeVisible()
    await expect(ask.getByRole('button', { name: 'New quiz' })).toBeVisible()

    await first.getByRole('button', { name: 'Save as flashcard' }).click()
    await expect(first.getByRole('button', { name: 'Saved' })).toBeDisabled()
    await expectAccessible(page)

    await page.reload()
    if (!isWide(page)) await readerPage.ask.open()
    await expect(readerPage.ask.question(1).getByText('Right.', { exact: true })).toBeVisible()
    await expect(readerPage.ask.question(2).getByText(/^Not quite\./)).toBeVisible()
    await expect(ask.getByText('You got 4 of 5 right.')).toBeVisible()
    await expect(readerPage.ask.question(1).getByRole('button', { name: 'Save as flashcard' })).toBeEnabled()
  })

  test('flashcards: Save all, then a review on the Flashcards page where Again comes back at the end, and Delete', async ({
    page,
    readerPage,
    flashcardsPage,
  }, testInfo) => {
    await readerWithKey(page)
    const ask = await readerPage.ask.open()
    await ask.getByRole('button', { name: 'Make flashcards from this chapter so far' }).click()
    await expect(ask.getByText(/^8 flashcards from this chapter so far/)).toBeVisible()
    await expect(readerPage.ask.card(card(1)).getByText('What the page says (1).')).toBeVisible()
    await ask.getByRole('button', { name: 'Save all' }).click()
    await expect(ask.getByText('Saved 8')).toBeVisible()
    await ask.getByRole('link', { name: 'Review them on the Flashcards page' }).click()
    await expect(page).toHaveURL(/\/account\/flashcards\?book=pride-and-prejudice$/)

    await expect(page.getByRole('heading', { level: 1, name: 'Flashcards' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pride and Prejudice' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'All cards (8)' })).toBeVisible()
    await expect(flashcardsPage.card(card(1)).getByText('Due now')).toBeVisible()
    await expect(flashcardsPage.card(card(1)).getByRole('link', { name: 'From Ch. 6 · p. 3' })).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)

    const review = flashcardsPage.review
    await review.getByRole('button', { name: 'Start review (8)' }).click()
    await expect(review.getByText('Card 1 of 8')).toBeVisible()
    await expect(review.getByText(card(1))).toBeFocused()
    await review.getByRole('button', { name: 'Show answer' }).click()
    await expect(review.getByText('What the page says (1).')).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)
    const saved = page.waitForResponse((r) => /\/account\/flashcards\/[0-9a-f-]{36}$/.test(r.url()))
    await review.getByRole('button', { name: 'Got it' }).click()
    await saved
    await expect(review.getByText(card(2))).toBeFocused()
    await flashcardsPage.grade('Again')
    await expect(review.getByText('Card 3 of 9')).toBeVisible()

    if (testInfo.project.name === 'desktop') {
      await expect(review.getByText('Space shows the answer · 1 Again · 2 Got it')).toBeVisible()
      await page.keyboard.press('Space')
      await expect(review.getByText('What the page says (3).')).toBeFocused()
      const graded = page.waitForResponse((r) => /\/account\/flashcards\/[0-9a-f-]{36}$/.test(r.url()))
      await page.keyboard.press('2')
      await graded
    } else {
      await flashcardsPage.grade('Got it')
    }
    for (let n = 4; n <= 8; n++) {
      await expect(review.getByText(card(n))).toBeVisible()
      await flashcardsPage.grade('Got it')
    }
    await expect(review.getByText('Card 9 of 9')).toBeVisible()
    await expect(review.getByText(card(2))).toBeVisible()
    await flashcardsPage.grade('Got it')
    await expect(review.getByText(/^Done for now\. Next card due on \d{1,2} [A-Z][a-z]{2}\.$/)).toBeVisible()
    await expect(review.getByRole('link', { name: 'Back to all books' })).toBeVisible()
    await expect(flashcardsPage.card(card(1)).getByText(/^Next review /)).toBeVisible()

    await flashcardsPage.card(card(3)).getByRole('button', { name: 'Delete this card' }).click()
    await expect(flashcardsPage.card(card(3)).getByText('Delete this card?')).toBeVisible()
    await flashcardsPage.card(card(3)).getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'All cards (7)' })).toBeVisible()
    await expect(flashcardsPage.card(card(3))).toHaveCount(0)

    await flashcardsPage.goto()
    await expect(flashcardsPage.books.getByRole('link', { name: 'Pride and Prejudice' })).toBeVisible()
    await expect(flashcardsPage.books.getByText(/^7 cards · next due \d{1,2} [A-Z][a-z]{2}$/)).toBeVisible()
    await expectAccessible(page)
    await expectNoSideways(page)
  })

  test('a quiz stopped while it is written shows only Stopped', async ({ page, readerPage }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one check of Stop on a quiz; ask.spec covers Stop itself')
    await readerWithKey(page, STUB_KEYS.slow)
    const ask = await readerPage.ask.open()
    await ask.getByRole('button', { name: 'Quiz me on this chapter so far' }).click()
    await expect(ask.getByText('Writing your quiz…')).toHaveCount(2)
    await expect(ask.getByText('Writing your quiz…').first()).toBeVisible()
    await ask.getByRole('button', { name: 'Stop the answer' }).click()
    await expect(ask.getByText('Stopped', { exact: true })).toBeVisible()
    await expect(ask.getByText('Quiz me on this chapter so far.')).toBeVisible()
    await expect(readerPage.ask.question(1)).toHaveCount(0)
    await expect(ask.getByRole('button', { name: 'Copy' })).toHaveCount(0)
  })

  test('the page sends a signed-out visitor to sign in, and is a 404 for a book it doesn’t know', {
    tag: '@http',
  }, async ({ request }) => {
    const signedOut = await request.get('/account/flashcards?book=pride-and-prejudice', { maxRedirects: 0 })
    expect(signedOut.status()).toBeGreaterThanOrEqual(300)
    expect(signedOut.status()).toBeLessThan(400)
    expect(signedOut.headers().location).toContain(
      `/login?next=${encodeURIComponent('/account/flashcards?book=pride-and-prejudice')}`,
    )
    const list = await request.get('/account/flashcards', { maxRedirects: 0 })
    expect(list.headers().location).toContain(`/login?next=${encodeURIComponent('/account/flashcards')}`)

    await createUser(request, { signedIn: true })
    expect((await request.get('/account/flashcards?book=no-such-book')).status()).toBe(404)
    expect((await request.get('/account/flashcards')).status()).toBe(200)
  })
})
