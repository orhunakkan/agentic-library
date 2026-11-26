import { randomBytes } from 'node:crypto'
import type { Page } from '@playwright/test'
import { SignupPage, type UsersPage } from '../pages'
import { createUser } from '../support/accounts'
import { expect, expectAccessible, hydrated, test } from '../support/fixtures'
import { latestLink } from '../support/mail'

const PASSWORD = 'a long password for signing up'

const freshName = () => `s-${randomBytes(5).toString('hex')}`

async function openUsersPage(page: Page, usersPage: UsersPage) {
  const admin = await createUser(page.request, { role: 'admin', signedIn: true })
  await usersPage.goto()
  await expect(usersPage.heading).toBeVisible()
  return admin
}

test.describe('Sign up', () => {
  test('sign up with an email address', async ({ page, request, accountPage, loginPage, signupPage }) => {
    const username = freshName()
    const address = `${username}@example.net`

    await loginPage.goto()
    await hydrated(page)
    await expect(page.getByRole('main')).toContainText('New to Folio?')
    await page.getByRole('link', { name: 'Create an account' }).click()
    await expect(page).toHaveURL(/\/signup$/)
    await hydrated(page)
    await expect(signupPage.heading).toBeVisible()
    await expectAccessible(page)

    await signupPage.askForLink('ann@localhost')
    await expect(signupPage.alert).toHaveText('Enter an email address, like name@example.com.')
    await expect(signupPage.emailAddress).toHaveAttribute('aria-invalid', 'true')

    await hydrated(page)
    await signupPage.askForLink(address)
    await expect(signupPage.status).toHaveText(
      'Check your inbox. If the address can receive mail, a link to finish signing up is on its way. It works for 24 hours.',
    )

    const link = await latestLink(request, address, '/signup')
    await signupPage.goto(link)
    await hydrated(page)
    await expect(page.getByRole('main')).toContainText(`For ${address}.`)
    await expectAccessible(page)

    await signupPage.createAccount('tester', PASSWORD)
    await expect(signupPage.alert).toHaveText('That username isn’t available. Try another.')
    await expect(signupPage.username).toHaveValue('tester')
    await expect(signupPage.username).toHaveAttribute('aria-invalid', 'true')

    await hydrated(page)
    await signupPage.createAccount(username, PASSWORD)
    await expect(page).toHaveURL(/\/account\?status=welcome$/)
    await hydrated(page)
    await expect(signupPage.status).toHaveText(`Welcome to Folio, ${username}. Your account is ready.`)
    const email = accountPage.email
    await expect(email).toContainText(address)
    await expect(email).toContainText('Confirmed')

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/library$/)
    await page.waitForLoadState('networkidle')
    await hydrated(page)
    await signupPage.goto(link)
    await hydrated(page)
    await expect(signupPage.alert).toHaveText('This link has expired or was already used.')
  })

  test('join from an invite, and revoke another', async ({ page, browser, usersPage }) => {
    const admin = await openUsersPage(page, usersPage)
    const note = `for ${freshName()}`
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const invites = usersPage.invites
    await expect(invites).toContainText('An invite link lets one person create a member account.')

    await usersPage.inviteButton.click()
    const dialog = usersPage.inviteDialog
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Note (optional)').fill(note)
    await dialog.getByRole('button', { name: 'Create link' }).click()
    const panel = usersPage.inviteLinkPanel
    await expect(panel).toBeVisible()
    const field = panel.getByLabel('Invite link')
    const link = await field.inputValue()
    expect(link).toMatch(/^http:\/\/localhost:3100\/signup\?token=[A-Za-z0-9_-]{43}$/)
    await expect(field).toBeFocused()
    await expectAccessible(page)
    await panel.getByRole('button', { name: 'Copy' }).click()
    await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible()
    await panel.getByRole('button', { name: 'Done' }).click()
    await expect(panel).toBeHidden()
    await expect(usersPage.invite(note)).toContainText(`Made by ${admin.username}`)
    expect(await page.content()).not.toContain(link)

    const revokedNote = `for ${freshName()}`
    const revokedPanel = await usersPage.createInvite(revokedNote)
    const revokedLink = await revokedPanel.getByLabel('Invite link').inputValue()
    await revokedPanel.getByRole('button', { name: 'Done' }).click()
    const row = usersPage.invite(revokedNote)
    await row.getByRole('button', { name: /^Revoke/ }).click()
    const confirm = page.getByRole('dialog', { name: 'Revoke this invite?' })
    await expect(confirm).toContainText('The link stops working.')
    await confirm.getByRole('button', { name: 'Revoke' }).click()
    await expect(usersPage.status).toHaveText('The invite was revoked.')
    await expect(row).toHaveCount(0)

    const username = freshName()
    const context = await browser.newContext()
    try {
      const guest = await context.newPage()
      const signup = new SignupPage(guest)
      await guest.goto(revokedLink)
      await hydrated(guest)
      await expect(signup.alert).toHaveText('This link has expired or was already used.')
      await expect(guest.getByRole('link', { name: 'Ask for a new one' })).toBeVisible()

      await guest.goto(link)
      await hydrated(guest)
      await expect(guest.getByRole('main')).toContainText('You’ve been invited to Folio.')
      await expectAccessible(guest)
      await signup.createAccount(username, PASSWORD)
      await expect(guest).toHaveURL(/\/account\?status=welcome$/)
      await expect(signup.status).toHaveText(
        `Welcome to Folio, ${username}. Your account is ready. Add an email address below so you can reset a forgotten password.`,
      )
    } finally {
      await context.close()
    }

    await page.reload()
    await hydrated(page)
    await expect(usersPage.invite(note)).toHaveCount(0)
    await expect(usersPage.actionsButton(username)).toBeVisible()
  })

  test('the Privacy and Terms pages, from /signup and from both footers', async ({ page, signupPage }) => {
    await signupPage.goto()
    await hydrated(page)
    await page.getByRole('main').getByRole('link', { name: 'Privacy' }).click()
    await expect(page).toHaveURL(/\/privacy$/)
    await hydrated(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
    await expectAccessible(page)
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
      'Reading without an account',
      'With an account',
      'Who else sees it',
      'Your choices',
      'Children',
      'Questions',
    ])
    await expect(page.getByRole('link', { name: 'privacy@folio.test' })).toHaveAttribute(
      'href',
      'mailto:privacy@folio.test',
    )

    for (const path of ['/', '/library']) {
      await page.goto(path)
      await hydrated(page)
      await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click()
      await expect(page).toHaveURL(/\/privacy$/)
      await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
    }

    await signupPage.goto()
    await hydrated(page)
    await page.getByRole('main').getByRole('link', { name: 'Terms' }).click()
    await expect(page).toHaveURL(/\/terms$/)
    await hydrated(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Terms' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Folio is run by Orhun Akkan')
    await expect(page.getByRole('main').getByRole('link', { name: 'privacy@folio.test' })).toBeVisible()
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([
      'Who you’re dealing with',
      'Your own API keys',
      'Using Folio',
      'No warranty',
      'Changes to these terms',
      'Questions',
    ])
    await expect(page.getByRole('main')).not.toContainText(/\$\d|\bPro\b|subscription/)
    await expectAccessible(page)
    await page.goto('/privacy')
    await hydrated(page)
    await expect(page.getByRole('main')).not.toContainText(/\bPro\b|subscription/)
    await page.goto('/library')
    await hydrated(page)
    await expect(page.getByTestId('footer-link')).toHaveText([
      'Browse the library',
      'About Folio',
      'Privacy',
      'Terms',
      'Credits',
    ])
  })

  test('the link pages are never stored, and a foreign post is refused', { tag: '@http' }, async ({ request }) => {
    const answer = await request.get('/signup?token=x')
    expect(answer.headers()['cache-control']).toBe('private, no-store')
    expect(answer.headers()['referrer-policy']).toBe('strict-origin')
    const foreign = await request.post('/signup', {
      form: { email: 'ann@example.com' },
      headers: { origin: 'https://evil.example' },
      maxRedirects: 0,
    })
    expect(foreign.status()).toBe(403)
  })
})
