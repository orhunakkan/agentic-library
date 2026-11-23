import type { APIRequestContext } from '@playwright/test'
import { LoginPage } from '../pages'
import { createUser, signInOverHttp, type TestUser } from '../support/accounts'
import { expect, expectAccessible, hydrated, test } from '../support/fixtures'
import { latestLink, mailTo } from '../support/mail'

const ORIGIN = 'http://localhost:3100'

async function withConfirmedAddress(api: APIRequestContext, user: TestUser, address: string) {
  const headers = { origin: ORIGIN }
  await signInOverHttp(api, user)
  const added = await api.post('/account', {
    form: { intent: 'email-add', email: address, current: user.password },
    headers,
    maxRedirects: 0,
  })
  expect(added.headers().location).toBe('/account?status=email-sent#email')
  const token = new URL(await latestLink(api, address, '/confirm-email'), ORIGIN).searchParams.get('token') ?? ''
  const confirmed = await api.post('/confirm-email', { form: { token }, headers, maxRedirects: 0 })
  expect(confirmed.headers().location).toBe('/account?status=email-confirmed#email')
}

test.describe('Email', () => {
  test('add an address and confirm it from the link', async ({ page, request, accountPage }) => {
    const user = await createUser(page.request, { signedIn: true })
    const address = `${user.username}@example.com`
    await accountPage.goto()
    const section = accountPage.email
    await expect(section).toContainText('Add an email address so you can reset your password if you forget it.')
    await expectAccessible(page)

    await accountPage.addEmail(address, 'not my password at all')
    await expect(section.getByRole('alert')).toHaveText('Your password is incorrect.')
    await expect(section.getByLabel('Current password')).toHaveAttribute('aria-invalid', 'true')

    await accountPage.addEmail(address, user.password)
    await expect(accountPage.status).toHaveText('Check your inbox: the confirmation link works for 24 hours.')
    await expect(section).toContainText(`Waiting for confirmation: ${address}.`)
    await expect(section.getByRole('heading', { name: 'Use a different address' })).toBeVisible()
    await expectAccessible(page)

    const opened = await page.goto(await latestLink(request, address, '/confirm-email'))
    expect(opened?.headers()['cache-control']).toBe('private, no-store')
    expect(opened?.headers()['referrer-policy']).toBe('strict-origin')
    await hydrated(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Confirm your email address')
    await expect(page.getByRole('main')).toContainText(`Use ${address} as your account’s email address?`)
    await expectAccessible(page)
    await page.getByRole('button', { name: 'Confirm address' }).click()

    await expect(page).toHaveURL(/\/account\?status=email-confirmed#email$/)
    await expect(accountPage.status).toHaveText('Your email address is confirmed.')
    await expect(section.getByRole('definition').first()).toHaveText(address)
    await expect(section.getByText('Confirmed', { exact: true })).toBeVisible()
    await expect(section.getByRole('heading', { name: 'Change address' })).toBeVisible()
    await expect(section.getByRole('button', { name: 'Remove address' })).toBeVisible()
    await expectAccessible(page)

    await page.goBack()
    await page.reload()
    await expect(accountPage.alert).toHaveText('This link has expired or was already used.')
  })

  test('confirm while signed out: sign in from the page and land back on it', async ({ page, request, loginPage }) => {
    const user = await createUser(request)
    const address = `${user.username}@example.org`
    await signInOverHttp(request, user)
    const added = await request.post('/account', {
      form: { intent: 'email-add', email: address, current: user.password },
      headers: { origin: ORIGIN },
      maxRedirects: 0,
    })
    expect(added.headers().location).toBe('/account?status=email-sent#email')

    await page.goto(await latestLink(request, address, '/confirm-email'))
    await expect(page.getByRole('main')).toContainText(
      'Sign in to confirm this address. The link only works for the account that asked for it.',
    )
    await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login\?next=/)
    await hydrated(page)
    await loginPage.submit(user)

    await expect(page).toHaveURL((url) => url.pathname === '/confirm-email' && url.searchParams.has('token'))
    await hydrated(page)
    await page.getByRole('button', { name: 'Confirm address' }).click()
    await expect(page.getByRole('main').getByRole('status')).toHaveText('Your email address is confirmed.')
  })
})

test.describe('Forgotten password', () => {
  test('reset it from /login with the mailed link', async ({ page, request }) => {
    const user = await createUser(request)
    const address = `${user.username}@example.net`
    await withConfirmedAddress(request, user, address)

    await page.goto('/login')
    await expect(page.getByRole('main')).toContainText('New to Folio? Create an account')
    await page.getByRole('link', { name: 'Forgot your password?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await hydrated(page)
    await expectAccessible(page)
    await page.getByLabel('Username or email address').fill(user.username)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('main').getByRole('status')).toContainText(
      'If that account has a confirmed email address, a link is on its way. It works once, for 30 minutes.',
    )
    await expect(page.getByLabel('Username or email address')).toHaveValue('')

    const link = await latestLink(request, address, '/reset-password')
    const opened = await page.goto(link)
    expect(opened?.headers()['referrer-policy']).toBe('strict-origin')
    await expect(page.getByRole('main')).toContainText(`For the account ${user.username}.`)
    await expectAccessible(page)

    const newPassword = 'my brand new e2e password'
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Confirm new password').fill(`${newPassword} typo`)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('The new passwords don’t match.')

    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Confirm new password').fill(newPassword)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page).toHaveURL(/\/login\?status=password-reset$/)
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'Your password has been changed and every session signed out. Sign in with the new one.',
    )
    expect((await mailTo(request, address))[0]?.subject).toBe('Your Folio password was reset')

    await new LoginPage(page).signIn({ ...user, password: newPassword })
    await expect(page).toHaveURL(/\/library$/)
  })

  test('a used link says it has expired', async ({ page, request }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop',
      'Set up over HTTP; the page is one alert, and the layout adds nothing.',
    )
    const user = await createUser(request)
    const address = `${user.username}@example.net`
    await withConfirmedAddress(request, user, address)
    await request.post('/forgot-password', { form: { identifier: address }, headers: { origin: ORIGIN } })
    const link = await latestLink(request, address, '/reset-password')
    const token = new URL(link, ORIGIN).searchParams.get('token') ?? ''
    const password = 'another fresh e2e password'
    const used = await request.post('/reset-password', {
      form: { token, password, confirm: password },
      headers: { origin: ORIGIN },
      maxRedirects: 0,
    })
    expect(used.headers().location).toBe('/login?status=password-reset')

    await page.goto(link)
    await hydrated(page)
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('This link has expired or was already used.')
    await expect(page.getByRole('link', { name: 'Ask for a new one' })).toHaveAttribute('href', '/forgot-password')
  })
})
