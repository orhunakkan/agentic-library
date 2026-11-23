import type { Locator, Page } from '@playwright/test'
import { RatingControl } from './components/rating-control'

export class AudiobookPage {
  readonly heading: Locator
  readonly listen: Locator
  readonly chapters: Locator
  readonly rating: RatingControl

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 })
    this.listen = page.getByRole('button', { name: /^(Listen|Continue listening)$/ })
    this.chapters = page.getByRole('region', { name: 'Chapters' })
    this.rating = new RatingControl(page)
  }

  chapter(number: number, title: string) {
    return this.chapters.getByRole('button', { name: new RegExp(`^(Play|Pause) ${number}\\. ${title} · `) })
  }
}
