import type { Locator, Page } from '@playwright/test'
import type { TestUser } from '../support/accounts'
import { hydrated } from '../support/settle'

export class LoginPage {
  readonly heading: Locator
  readonly username: Locator
  readonly password: Locator
  readonly submitButton: Locator
  readonly error: Locator
  readonly passkeyButton: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Sign in' })
    this.username = page.getByLabel('Username')
    this.password = page.getByLabel('Password', { exact: true })
    this.submitButton = page.getByRole('button', { name: 'Sign in', exact: true })
    this.error = page.getByRole('main').getByRole('alert')
    this.passkeyButton = page.getByRole('button', { name: 'Sign in with a passkey' })
  }

  goto(next?: string) {
    return this.page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  }

  async submit(user: TestUser) {
    await this.username.fill(user.username)
    await this.password.fill(user.password)
    await this.submitButton.click()
  }

  async signIn(user: TestUser, next?: string) {
    await this.goto(next)
    await this.submit(user)
    await this.page.waitForURL((url) => url.pathname !== '/login' || url.searchParams.has('error'))
    await this.page.waitForLoadState('networkidle')
    await hydrated(this.page)
  }

  async signInWithPasskey() {
    await this.passkeyButton.click()
    await this.page.waitForURL((url) => url.pathname !== '/login')
    await this.page.waitForLoadState('networkidle')
    await hydrated(this.page)
  }
}
