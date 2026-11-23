import type { Locator, Page, Response } from '@playwright/test'
import { press } from '../layout'

const starName = (n: number) => ({ name: n === 1 ? '1 star' : `${n} stars`, exact: true })

export class RatingControl {
  readonly group: Locator
  readonly value: Locator
  readonly clearButton: Locator
  readonly error: Locator

  constructor(readonly page: Page) {
    this.group = page.getByRole('group', { name: 'Your rating' })
    this.value = page.getByTestId('book-rating-value')
    this.clearButton = page.getByRole('button', { name: 'Clear rating' })
    this.error = page.getByTestId('book-rating-error')
  }

  star(n: number) {
    return this.group.getByRole('radio', starName(n))
  }

  answered(): Promise<Response> {
    return this.page.waitForResponse((r) => r.url().endsWith('/account/ratings') && r.request().method() === 'POST')
  }

  async rate(n: number): Promise<Response> {
    const answered = this.answered()
    await press(this.page, this.group.locator('label').filter({ has: this.page.getByRole('radio', starName(n)) }))
    return answered
  }

  async clear(): Promise<Response> {
    const answered = this.answered()
    await press(this.page, this.clearButton)
    return answered
  }
}
