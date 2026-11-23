import { LoginPage } from '../pages'
import { createUser, SEEDED, signInOverHttp } from '../support/accounts'
import { expect, expectAccessible, hydrated, test } from '../support/fixtures'

const GENERIC = 'Username or password is incorrect.'

test.describe('Sign in', () => {
  test('the seeded accounts sign in from the header and see their account menu', async ({
    page,
    context,
    libraryPage,
    loginPage,
    accountMenu,
    accountPage,
    usersPage,
  }) => {
    await libraryPage.goto()
    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(loginPage.heading).toBeVisible()
    await expect(loginPage.username).toHaveAttribute('autocomplete', 'username')
    await expect(loginPage.password).toHaveAttribute('autocomplete', 'current-password')
    await expectAccessible(page)

    await loginPage.submit(SEEDED.tester)
    await expect(page).toHaveURL(/\/library$/)
    await expect(accountMenu.button(SEEDED.tester.username)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0)

    const cookie = (await context.cookies()).find((c) => c.name === 'session')
    expect(cookie).toMatchObject({ httpOnly: true, path: '/' })
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const days = ((cookie?.expires ?? 0) * 1000 - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThanOrEqual(30)

    await accountPage.goto()
    await expect(page.getByText('Member', { exact: true })).toBeVisible()
    await expect(accountPage.nav.getByRole('link')).toHaveText([
      'Account',
      'My books',
      'Highlights',
      'Flashcards',
      'Prompts',
      'API keys',
    ])
    const response = await usersPage.goto()
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page isn’t on our shelves')
  })

  test('a wrong password gets the generic message', async ({ page, request, loginPage }) => {
    const user = await createUser(request)
    await loginPage.goto()
    await loginPage.submit({ username: user.username, password: 'not the right password' })
    await expect(loginPage.error).toHaveText(GENERIC)
    await expect(loginPage.username).toHaveAttribute('aria-invalid', 'true')
    await expectAccessible(page)
  })

  test('works without JavaScript', async ({ browser, request }) => {
    const user = await createUser(request)
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    try {
      const login = new LoginPage(page)
      await login.goto('/account')
      await login.submit(user)
      await expect(page).toHaveURL(/\/account$/)
      await expect(page.getByRole('heading', { level: 1, name: user.username })).toBeVisible()
    } finally {
      await context.close()
    }
  })
})

test.describe('Sign out and request safety', () => {
  test('a protected page sends you to sign in and back, and sign out ends the session', async ({
    page,
    context,
    request,
    loginPage,
    accountMenu,
  }) => {
    const user = await createUser(request)
    await page.goto('/account/api-keys')
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fapi-keys$/)
    await loginPage.submit(user)
    await expect(page).toHaveURL(/\/account\/api-keys$/)
    await expect(page.getByRole('heading', { level: 1, name: 'API keys' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await hydrated(page)

    await accountMenu.signOut(user.username)
    await expect(page).toHaveURL(/\/library$/)
    await hydrated(page)
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
    expect((await context.cookies()).find((c) => c.name === 'session')).toBeUndefined()
    await page.goto('/account')
    await expect(page).toHaveURL(/\/login\?next=%2Faccount$/)
  })

  test('a cross-origin POST is refused with 403', { tag: '@http' }, async ({ request }) => {
    for (const path of ['/login', '/logout', '/account', '/account/api-keys']) {
      const response = await request.post(path, {
        form: { username: SEEDED.tester.username, password: SEEDED.tester.password },
        headers: { origin: 'https://evil.example' },
        maxRedirects: 0,
      })
      expect(response.status(), path).toBe(403)
    }
  })

  test('a GET never signs out', { tag: '@http' }, async ({ request }) => {
    const user = await createUser(request)
    await signInOverHttp(request, user)
    await request.get('/logout', { maxRedirects: 0 })
    const account = await request.get('/account', { maxRedirects: 0 })
    expect(account.status()).toBe(200)
  })

  test('sign-in and signed-in pages are not cached', { tag: '@http' }, async ({ request }) => {
    const login = await request.get('/login')
    expect(login.headers()['cache-control']).toBe('private, no-store')
    const library = await request.get('/library')
    expect(library.headers()['cache-control']).not.toBe('private, no-store')
    await signInOverHttp(request, await createUser(request))
    const signedIn = await request.get('/library')
    expect(signedIn.headers()['cache-control']).toBe('private, no-store')
  })
})
