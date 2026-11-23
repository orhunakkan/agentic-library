import type { Locator, Page } from '@playwright/test'

export class ImportPage {
  readonly picker: Locator
  readonly review: Locator
  readonly saveButton: Locator
  readonly books: Locator
  readonly alert: Locator
  readonly audiobookReview: Locator

  constructor(readonly page: Page) {
    this.picker = page.getByLabel('Choose a book file')
    this.review = page.getByRole('form', { name: 'Review before saving' })
    this.saveButton = this.review.getByRole('button', { name: 'Save to my shelf' })
    this.books = page.getByRole('region', { name: 'Your books' })
    this.alert = page.getByRole('main').getByRole('alert')
    this.audiobookReview = page.getByRole('form', { name: 'Review the audiobook' })
  }

  goto() {
    return this.page.goto('/account/books')
  }

  async pick(file: string) {
    await this.picker.setInputFiles(file)
    await this.page.getByRole('heading', { name: 'Review before saving' }).waitFor()
  }

  chapterTitles() {
    return this.page
      .getByRole('textbox', { name: /^Chapter \d+ title$/ })
      .evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value))
  }

  async pickAudiobook(files: string[]) {
    await this.picker.setInputFiles(files)
    await this.page.getByRole('heading', { name: 'Review the audiobook' }).waitFor()
  }

  deleteButton(title: string) {
    return this.page.getByRole('button', { name: `Delete ${title}` })
  }
}
