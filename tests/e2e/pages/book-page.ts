import type { Locator, Page } from '@playwright/test'
import { AudioPlayer } from './components/audio-player'
import { RatingControl } from './components/rating-control'
import { ShelfPicker } from './components/shelf-picker'

export class BookPage {
  readonly startReading: Locator
  readonly listenButton: Locator
  readonly contents: Locator
  readonly search: Locator
  readonly audio: AudioPlayer
  readonly shelves: ShelfPicker
  readonly rating: RatingControl
  readonly removeButton: Locator
  readonly restoreButton: Locator
  readonly cover: Locator
  readonly about: Locator
  readonly details: Locator
  readonly findPanel: Locator

  constructor(readonly page: Page) {
    this.startReading = page.getByRole('link', { name: 'Start reading' })
    this.listenButton = page.getByRole('button', { name: 'Listen' })
    this.contents = page.getByRole('region', { name: 'Contents' })
    this.search = page.getByRole('searchbox', { name: 'Search in book' })
    this.audio = new AudioPlayer(page)
    this.shelves = new ShelfPicker(page)
    this.rating = new RatingControl(page)
    this.removeButton = page.getByRole('button', { name: 'Remove from library' })
    this.restoreButton = page.getByRole('button', { name: 'Restore to library' })
    this.cover = page.locator('section[aria-labelledby="book-title"] .cover')
    this.about = page.getByRole('region', { name: 'About this book' })
    this.details = page.locator('#details')
    this.findPanel = page.getByRole('region', { name: 'Find cover and details' })
  }

  goto(series: string, book: string, suffix = '') {
    return this.page.goto(`/library/${series}/${book}${suffix}`)
  }

  gotoImported(id: string) {
    return this.page.goto(`/account/books/${id}`)
  }

  heading(title: string) {
    return this.page.getByRole('heading', { level: 1, name: title })
  }

  tab(name: 'Text' | 'Audiobook') {
    return this.page.getByRole('tab', { name })
  }
}
