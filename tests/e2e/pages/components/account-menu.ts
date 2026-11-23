import type { Locator, Page } from '@playwright/test'

export class AccountMenu {
  readonly signOutButton: Locator

  constructor(readonly page: Page) {
    this.signOutButton = page.getByRole('button', { name: 'Sign out' })
  }

  button(username: string) {
    return this.page.getByLabel(`Account menu, signed in as ${username}`).filter({ visible: true })
  }

  async signOut(username: string) {
    await this.button(username).click()
    await this.signOutButton.click()
  }
}
