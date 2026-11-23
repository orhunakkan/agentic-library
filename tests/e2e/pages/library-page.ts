import type { Locator, Page } from '@playwright/test'
import { SiteNav } from './components/site-nav'

export class LibraryPage {
  readonly heading: Locator
  readonly stats: Locator
  readonly search: Locator
  readonly clearButton: Locator
  readonly shelves: Locator
  readonly nav: SiteNav
  readonly chips: Locator
  readonly continueReading: Locator
  readonly readingCard: Locator
  readonly myShelf: Locator
  readonly removedBooks: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Library' })
    this.stats = page.getByRole('complementary', { name: 'Library stats' })
    this.search = page.getByRole('searchbox', { name: 'Search books' })
    this.clearButton = page.getByRole('button', { name: 'Clear' })
    this.shelves = page.locator('main section[id]:not(#removed-books)')
    this.nav = new SiteNav(page)
    this.chips = page.getByRole('group', { name: 'Filter books' })
    this.continueReading = page.getByRole('region', { name: 'Continue reading' })
    this.readingCard = page.getByRole('link', { name: /^Your reading/ })
    this.myShelf = page.getByRole('region', { name: 'My shelf' })
    this.removedBooks = page.getByRole('region', { name: 'Removed from your library' })
  }

  goto(suffix = '') {
    return this.page.goto(`/library${suffix}`)
  }

  typeSearch(text: string) {
    return this.search.pressSequentially(text)
  }

  shelf(id: string) {
    return this.page.locator(`#${id}`)
  }

  filter(name: string, exact = false) {
    return this.page.getByRole('button', { name, exact })
  }

  showing(books: number) {
    return this.page.getByText(`Showing ${books} ${books === 1 ? 'book' : 'books'}`)
  }

  shelfRow(name: string) {
    return this.page.getByRole('region', { name })
  }

  shelfTitles(name: string) {
    return this.shelfRow(name)
      .getByRole('listitem')
      .evaluateAll((items) => items.map((li) => li.querySelector('p')?.textContent ?? ''))
  }
}
