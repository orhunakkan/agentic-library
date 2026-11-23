import type { Locator, Page } from '@playwright/test'

export class SignupPage {
  readonly heading: Locator
  readonly emailAddress: Locator
  readonly sendLinkButton: Locator
  readonly username: Locator
  readonly password: Locator
  readonly confirmPassword: Locator
  readonly createButton: Locator
  readonly alert: Locator
  readonly status: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Create an account' })
    this.emailAddress = page.getByLabel('Email address')
    this.sendLinkButton = page.getByRole('button', { name: 'Send sign-up link' })
    this.username = page.getByLabel('Username')
    this.password = page.getByLabel('Password', { exact: true })
    this.confirmPassword = page.getByLabel('Confirm password')
    this.createButton = page.getByRole('button', { name: 'Create account' })
    this.alert = page.getByRole('alert')
    this.status = page.getByRole('main').getByRole('status')
  }

  goto(path = '/signup') {
    return this.page.goto(path)
  }

  async askForLink(address: string) {
    await this.emailAddress.fill(address)
    await this.sendLinkButton.click()
  }

  async createAccount(username: string, password: string) {
    await this.username.fill(username)
    await this.password.fill(password)
    await this.confirmPassword.fill(password)
    await this.createButton.click()
  }
}
