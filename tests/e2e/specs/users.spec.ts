import { randomBytes } from 'node:crypto'
import type { Page } from '@playwright/test'
import { AccountPage, type UsersPage } from '../pages'
import { createUser } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'

const freshName = () => `u-${randomBytes(5).toString('hex')}`

async function signedInAdmin(page: Page) {
  const admin = await createUser(page.request, { role: 'admin', signedIn: true })
  await page.goto('/account')
  return admin
}

async function openUsersPage(usersPage: UsersPage) {
  const { page } = usersPage
  await new AccountPage(page).nav.getByRole('link', { name: 'Users' }).click()
  await expect(page).toHaveURL(/\/account\/users$/)
  await expect(usersPage.heading).toBeVisible()
}

test.describe('Users page', () => {
  test('an admin adds a user, with the password shown once', async ({ page, usersPage }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await signedInAdmin(page)
    await openUsersPage(usersPage)
    await expect(page.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page')
    await expectAccessible(page)
    await expectNoSideways(page)

    await usersPage.addUserButton.click()
    const dialog = usersPage.addUserDialog
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio', { name: 'Member' })).toBeChecked()
    await expectAccessible(page)

    const name = freshName()
    await dialog.getByLabel('Username').fill(name)
    await dialog.getByRole('button', { name: 'Add user' }).click()
    const panel = usersPage.passwordPanel(name)
    await expect(panel).toBeVisible()
    const field = panel.getByLabel(`${name}’s password`)
    const password = await field.inputValue()
    expect(password).toHaveLength(24)
    await expect(field).toBeFocused()
    await expectAccessible(page)
    await panel.getByRole('button', { name: 'Copy' }).click()
    await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible()
    await panel.getByRole('button', { name: 'Done' }).click()
    await expect(panel).toBeHidden()
    await expect(usersPage.status).toHaveText(`${name} was added.`)
    await expect(usersPage.actionsButton(name)).toBeVisible()
    expect(await page.content()).not.toContain(password)
  })

  test('reset a password, disable and enable, and change the role', async ({ page, usersPage }) => {
    const member = await createUser(page.request)
    const admin = await signedInAdmin(page)
    await expect(page.getByRole('heading', { level: 1, name: admin.username })).toBeVisible()
    await expect(page.getByText('Admin', { exact: true })).toBeVisible()
    await openUsersPage(usersPage)

    await usersPage.act(member.username, 'Reset password')
    const confirm = page.getByRole('dialog', { name: `Reset ${member.username}’s password?` })
    await confirm.getByRole('button', { name: 'Reset password' }).click()
    const panel = usersPage.passwordPanel(member.username)
    await expect(panel.getByLabel(`${member.username}’s password`)).toHaveValue(/^.{24}$/)
    await panel.getByRole('button', { name: 'Done' }).click()
    await expect(usersPage.status).toHaveText(`${member.username}’s password was reset.`)

    await usersPage.act(member.username, 'Disable')
    const disable = page.getByRole('dialog', { name: `Disable ${member.username}?` })
    await disable.getByRole('button', { name: 'Disable' }).click()
    await expect(disable).toBeHidden()
    await expect(usersPage.status).toHaveText(`${member.username} was disabled.`)

    await usersPage.act(member.username, 'Enable')
    await expect(usersPage.status).toHaveText(`${member.username} was enabled.`)

    await usersPage.act(member.username, 'Make admin')
    await expect(usersPage.status).toHaveText(`${member.username} is now an admin.`)
    await usersPage.act(member.username, 'Make member')
    await expect(usersPage.status).toHaveText(`${member.username} is now a member.`)
  })

  test('delete needs the username typed', async ({ page, usersPage }) => {
    const member = await createUser(page.request)
    await signedInAdmin(page)
    await openUsersPage(usersPage)
    await usersPage.act(member.username, 'Delete…')
    const dialog = page.getByRole('dialog', { name: `Delete ${member.username}?` })
    const remove = dialog.getByRole('button', { name: 'Delete user' })
    await expect(remove).toBeDisabled()
    await expectAccessible(page)
    await dialog.getByLabel(`Type ${member.username} to confirm`).fill(member.username.toUpperCase())
    await expect(remove).toBeDisabled()
    await dialog.getByLabel(`Type ${member.username} to confirm`).fill(member.username)
    await expect(remove).toBeEnabled()
    await remove.click()
    await expect(dialog).toBeHidden()
    await expect(usersPage.status).toHaveText(`${member.username} was deleted.`)
    await expect(usersPage.actionsButton(member.username)).toHaveCount(0)
  })
})
