import type { Locator, Page } from '@playwright/test'

export class UsersPage {
  readonly heading: Locator
  readonly addUserButton: Locator
  readonly addUserDialog: Locator
  readonly status: Locator
  readonly invites: Locator
  readonly inviteButton: Locator
  readonly inviteDialog: Locator
  readonly inviteLinkPanel: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Users' })
    this.addUserButton = page.getByRole('button', { name: 'Add user' })
    this.addUserDialog = page.getByRole('dialog', { name: 'Add user' })
    this.status = page.getByRole('main').getByRole('status')
    this.invites = page.getByRole('region', { name: 'Invites' })
    this.inviteButton = this.invites.getByRole('button', { name: 'Invite someone' })
    this.inviteDialog = page.getByRole('dialog', { name: 'Invite someone' })
    this.inviteLinkPanel = page.getByRole('dialog', { name: 'Invite link' })
  }

  goto() {
    return this.page.goto('/account/users')
  }

  actionsButton(username: string) {
    return this.page.getByRole('button', { name: `Actions for ${username}` })
  }

  async act(username: string, item: string) {
    await this.actionsButton(username).click()
    await this.page.getByRole('menuitem', { name: item, exact: true }).click()
  }

  passwordPanel(username: string) {
    return this.page.getByRole('dialog', { name: `${username}’s password` })
  }

  invite(note: string) {
    return this.invites.getByRole('listitem').filter({ hasText: note })
  }

  async createInvite(note: string) {
    await this.inviteButton.click()
    await this.inviteDialog.getByLabel('Note (optional)').fill(note)
    await this.inviteDialog.getByRole('button', { name: 'Create link' }).click()
    return this.inviteLinkPanel
  }
}
