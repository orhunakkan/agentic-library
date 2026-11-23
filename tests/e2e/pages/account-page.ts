import type { Locator, Page } from '@playwright/test'
import { PasskeysSection } from './passkeys-section'

export class AccountPage {
  readonly nav: Locator
  readonly status: Locator
  readonly alert: Locator
  readonly changePasswordSection: Locator
  readonly passkeys: PasskeysSection
  readonly sessions: Locator
  readonly accessTokens: Locator
  readonly email: Locator
  readonly yourData: Locator
  readonly deleteAccount: Locator
  readonly anthropic: Locator
  readonly model: Locator

  constructor(readonly page: Page) {
    this.nav = page.getByRole('navigation', { name: 'Account' })
    this.status = page.getByRole('main').getByRole('status')
    this.alert = page.getByRole('main').getByRole('alert')
    this.changePasswordSection = page.getByRole('region', { name: 'Change password' })
    this.passkeys = new PasskeysSection(page)
    this.sessions = page.getByRole('region', { name: 'Sessions' })
    this.accessTokens = page.getByRole('region', { name: 'Access tokens' })
    this.email = page.getByRole('region', { name: 'Email' })
    this.yourData = page.getByRole('region', { name: 'Your data' })
    this.deleteAccount = page.getByRole('region', { name: 'Delete account' })
    this.anthropic = page.getByRole('region', { name: 'Anthropic' })
    this.model = page.getByRole('region', { name: 'Model for agent features' })
  }

  goto() {
    return this.page.goto('/account')
  }

  gotoApiKeys() {
    return this.page.goto('/account/api-keys')
  }

  async changePassword(current: string, password: string) {
    const form = this.changePasswordSection
    await form.getByLabel('Current password').fill(current)
    await form.getByLabel('New password', { exact: true }).fill(password)
    await form.getByLabel('Repeat new password', { exact: true }).fill(password)
    await form.getByRole('button', { name: 'Change password' }).click()
  }

  async addEmail(address: string, current: string) {
    await this.email.getByLabel('Email address').fill(address)
    await this.email.getByLabel('Current password').fill(current)
    await this.email.getByRole('button', { name: 'Send confirmation link' }).click()
  }

  async deleteWith(current: string) {
    await this.deleteAccount.getByLabel('Current password').fill(current)
    await this.deleteAccount.getByRole('button', { name: 'Delete my account' }).click()
  }

  async saveAnthropicKey(key: string, label = 'Anthropic API key') {
    await this.anthropic.getByLabel(label, { exact: true }).fill(key)
    await this.anthropic.getByRole('button', { name: 'Save' }).click()
  }
}
