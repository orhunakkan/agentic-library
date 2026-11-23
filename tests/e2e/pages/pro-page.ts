import type { Locator, Page } from '@playwright/test'

export class ProPage {
  readonly heading: Locator
  readonly offer: Locator
  readonly planLine: Locator
  readonly planStatus: Locator
  readonly manageBilling: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Folio Pro' })
    this.offer = page.getByTestId('pro-offer')
    this.planLine = page.getByRole('main').getByTestId('plan-line')
    this.planStatus = page.getByRole('main').getByTestId('plan-status')
    this.manageBilling = page.getByRole('button', { name: 'Manage billing' })
  }

  goto() {
    return this.page.goto('/account/plan')
  }

  choose(cadence: 'Monthly' | 'Yearly') {
    return this.page.getByRole('group', { name: 'Billing period' }).getByText(cadence, { exact: true }).click()
  }

  buyButton(label: string | RegExp = /^Go Pro, /) {
    return this.page.getByRole('button', { name: label })
  }
}
