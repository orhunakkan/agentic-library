import type { Locator, Page } from '@playwright/test'

export class PasskeysSection {
  readonly region: Locator
  readonly addButton: Locator
  readonly password: Locator
  readonly continueButton: Locator
  readonly rows: Locator
  readonly status: Locator

  constructor(readonly page: Page) {
    this.region = page.getByRole('region', { name: 'Passkeys' })
    this.addButton = this.region.getByRole('button', { name: 'Add a passkey' })
    this.password = this.region.getByLabel('Current password')
    this.continueButton = this.region.getByRole('button', { name: 'Continue' })
    this.rows = this.region.getByRole('list', { name: 'Your passkeys' }).getByRole('listitem')
    this.status = this.region.getByRole('status')
  }

  async add(password: string) {
    await this.addButton.click()
    await this.password.fill(password)
    await this.continueButton.click()
  }

  async remove(row: Locator) {
    await row.getByRole('button', { name: /^Remove/ }).click()
    await this.page.waitForURL((url) => url.searchParams.get('status') === 'passkey-removed')
    await this.page.waitForLoadState('networkidle')
  }
}
