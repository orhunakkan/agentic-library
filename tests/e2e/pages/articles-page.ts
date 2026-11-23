import type { Locator, Page } from '@playwright/test'

export class ArticlesPage {
  readonly title: Locator
  readonly address: Locator
  readonly saveButton: Locator
  readonly progress: Locator
  readonly error: Locator
  readonly readNew: Locator
  readonly openExisting: Locator
  readonly empty: Locator
  readonly count: Locator
  readonly cards: Locator

  constructor(readonly page: Page) {
    this.title = page.getByRole('heading', { level: 1, name: 'Articles' })
    this.address = page.getByLabel('Article address')
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true })
    this.progress = page.getByTestId('articles-progress')
    this.error = page.getByTestId('articles-error')
    this.readNew = page.getByTestId('articles-read-new')
    this.openExisting = page.getByTestId('articles-open-existing')
    this.empty = page.getByText('You haven’t saved an article yet.')
    this.count = page.getByTestId('articles-count')
    this.cards = page.getByTestId('article-card')
  }

  goto(url?: string) {
    return this.page.goto(url ? `/account/articles?url=${encodeURIComponent(url)}` : '/account/articles')
  }

  async save(url: string) {
    await this.address.fill(url)
    await this.saveButton.click()
  }

  card(title: string) {
    return this.cards.filter({ has: this.page.getByRole('heading', { name: title }) })
  }

  async remove(title: string) {
    await this.card(title)
      .getByRole('button', { name: /^Delete/ })
      .click()
    await this.page.waitForURL(/\/account\/articles\?status=deleted$/)
  }
}
