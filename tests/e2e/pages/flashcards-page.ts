import type { Locator, Page } from '@playwright/test'

export class FlashcardsPage {
  readonly books: Locator
  readonly review: Locator
  readonly cards: Locator

  constructor(readonly page: Page) {
    this.books = page.getByRole('region', { name: 'Your books' })
    this.review = page.getByRole('region', { name: 'Review' })
    this.cards = page.getByRole('region', { name: /^All cards/ })
  }

  goto(book?: string) {
    return this.page.goto(book ? `/account/flashcards?book=${book}` : '/account/flashcards')
  }

  card(front: string) {
    return this.cards.getByRole('listitem').filter({ hasText: front })
  }

  async grade(result: 'Again' | 'Got it') {
    await this.review.getByRole('button', { name: 'Show answer' }).click()
    const saved = this.page.waitForResponse((r) => /\/account\/flashcards\/[0-9a-f-]{36}$/.test(r.url()))
    await this.review.getByRole('button', { name: result }).click()
    return saved
  }
}
