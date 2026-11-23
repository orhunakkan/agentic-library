import type { Locator, Page } from '@playwright/test'
import { SiteNav } from './components/site-nav'

export class StatsPage {
  readonly heading: Locator
  readonly today: Locator
  readonly streak: Locator
  readonly best: Locator
  readonly goal: Locator
  readonly saveGoal: Locator
  readonly goalSaved: Locator
  readonly days: Locator
  readonly empty: Locator
  readonly finishedCount: Locator
  readonly finishedBooks: Locator
  readonly finishedStatus: Locator
  readonly nav: SiteNav

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Reading stats' })
    const today = page.getByRole('region', { name: 'Today' })
    this.today = today.getByTestId('stats-today')
    this.streak = today.getByTestId('stats-streak')
    this.best = today.getByTestId('stats-best-streak')
    this.goal = page.getByRole('combobox', { name: 'Daily goal' })
    this.saveGoal = page.getByRole('button', { name: 'Save goal' })
    this.goalSaved = page.getByRole('region', { name: 'Daily goal' }).getByRole('status')
    this.days = page.getByRole('region', { name: 'The last 7 days' }).getByRole('listitem')
    this.empty = page.getByText('Your reading time shows here once you read or listen to a book while signed in.')
    const finished = page.getByRole('region', { name: 'Books finished' })
    this.finishedCount = finished.getByTestId('stats-finished-count')
    this.finishedBooks = finished.getByRole('listitem')
    this.finishedStatus = finished.getByRole('status')
    this.nav = new SiteNav(page)
  }

  goto() {
    return this.page.goto('/account/stats')
  }

  async openFromNav() {
    const nav = await this.nav.open()
    await nav.getByRole('link', { name: 'Stats' }).click()
  }

  async setGoal(label: string) {
    await this.goal.selectOption({ label })
    await this.saveGoal.click()
  }

  unfinish(title: string) {
    return this.page.getByRole('button', { name: `Not finished: ${title}` }).click()
  }
}
