import type { Page } from '@playwright/test'
import { APPLE_TOUCH_ICON, webManifest } from '../../../src/shared/pwa/manifest.ts'
import { createUser } from '../support/accounts'
import { expect, expectAccessible, hydrated, test } from '../support/fixtures'

async function controlled(page: Page) {
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller))
}

const asIPhone = (standalone: boolean) => {
  Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => standalone })
  Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => 5 })
}

test.describe('Install app', () => {
  test('where the browser offers it, the row opens the install dialog, and goes once installed', async ({
    page,
    libraryPage,
    siteNav,
  }) => {
    await libraryPage.goto()
    const nav = await siteNav.open()
    const row = nav.getByRole('button', { name: 'Install app' })
    await expect(nav.getByRole('link', { name: 'Library' })).toBeVisible()
    await expect(row).toHaveCount(0)

    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true })
      const win = window as unknown as { prompted: number }
      win.prompted = 0
      Object.assign(event, {
        prompt: async () => {
          win.prompted++
        },
        userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      })
      dispatchEvent(event)
    })
    await expect(row).toBeVisible()
    await expectAccessible(page)
    await row.click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { prompted: number }).prompted)).toBe(1)
    await expect(row).toHaveCount(0)

    await page.evaluate(() => dispatchEvent(new Event('appinstalled')))
    await expect(page.getByText('Folio is installed.')).toBeVisible()
    await expect(row).toHaveCount(0)
  })

  test('on an iPhone, the row explains Share, then Add to Home Screen', async ({
    page,
    libraryPage,
    siteNav,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'An iPhone’s Safari, as the init script makes it.')
    await page.addInitScript(asIPhone, false)
    await libraryPage.goto()
    const nav = await siteNav.open()
    const row = nav.getByRole('button', { name: 'Install app' })
    await row.click()
    const dialog = page.getByRole('dialog', { name: 'Install Folio' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      'Tap the Share button, then Add to Home Screen. Folio then opens from your Home Screen in its own window.',
    )
    await expect(dialog).toContainText(
      'The Home Screen app keeps its own sign-in and settings, so sign in there once more.',
    )
    await expect(dialog.getByRole('button', { name: 'Done' })).toBeFocused()
    await expectAccessible(page)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(row).toBeFocused()
    await expect(nav.getByRole('navigation', { name: 'Main' })).toBeVisible()

    await row.click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toBeFocused()
  })

  test('on an iPhone, Folio running from the Home Screen offers no install', async ({
    page,
    libraryPage,
    siteNav,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'An iPhone’s Safari, as the init script makes it.')
    await page.addInitScript(asIPhone, true)
    await libraryPage.goto()
    const nav = await siteNav.open()
    await expect(nav.getByRole('link', { name: 'Library' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Install app' })).toHaveCount(0)
  })
})

const pngSize = (bytes: Buffer) => `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`

test.describe('Static files', () => {
  test('the manifest is served with its type, and every icon is a PNG of its listed size', { tag: '@http' }, async ({
    request,
  }) => {
    const response = await request.get('/manifest.webmanifest')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/manifest+json; charset=utf-8')
    expect(response.headers()['cache-control']).toBe('public, max-age=3600')
    const manifest = await response.json()
    expect(manifest).toEqual(webManifest())

    const icons = [
      ...manifest.icons.map((i: { src: string; sizes: string }) => [i.src, i.sizes]),
      [APPLE_TOUCH_ICON.src, `${APPLE_TOUCH_ICON.size}x${APPLE_TOUCH_ICON.size}`],
    ]
    for (const [src, sizes] of icons) {
      const icon = await request.get(src)
      expect(icon.status(), src).toBe(200)
      expect(icon.headers()['content-type'], src).toBe('image/png')
      expect(pngSize(await icon.body()), src).toBe(sizes)
    }
  })

  test('the worker and the offline page are never held stale', { tag: '@http' }, async ({ request }) => {
    for (const path of ['/sw.js', '/offline.html']) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(200)
      expect(response.headers()['cache-control'], path).toBe('no-cache')
    }
  })
})

test('the head links the manifest with credentials, the iOS icon and title, and the navy theme', async ({
  page,
  libraryPage,
}) => {
  await libraryPage.goto()
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('crossorigin', 'use-credentials')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Folio')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0B0D17')
})

test.describe('The service worker', () => {
  test.use({ serviceWorkers: 'allow' })
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'The worker is the same on every device; desktop is enough.')
  })

  test('a page the network can’t reach shows the offline page, and Try again loads it', async ({
    page,
    context,
    libraryPage,
  }) => {
    await libraryPage.goto()
    await controlled(page)
    await context.setOffline(true)
    await page.evaluate(() => location.assign('/library/jane-austen'))
    await expect(page.getByRole('heading', { level: 1, name: 'You’re offline' })).toBeVisible()
    await expect(page).toHaveTitle('Offline · Folio')
    await expect(page).toHaveURL('/library/jane-austen')
    await expectAccessible(page)

    await context.setOffline(false)
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Jane Austen' })).toBeVisible()
    await hydrated(page)
  })

  test('a page that asks for a password makes the worker step aside, so the browser can ask', async ({
    page,
    context,
    libraryPage,
  }) => {
    await libraryPage.goto()
    await controlled(page)
    await page.evaluate(async () => (await navigator.serviceWorker.ready).navigationPreload?.disable())
    let challenged = 0
    await context.route('**/library/jane-austen', async (route) => {
      if (challenged++ > 0) return route.continue()
      await route.fulfill({ status: 401, headers: { 'www-authenticate': 'Basic realm="dev"' }, body: 'Unauthorized' })
    })
    await page.evaluate(() => location.assign('/library/jane-austen'))
    await expect(page.getByRole('heading', { level: 1, name: 'Jane Austen' })).toBeVisible()
    expect(challenged).toBe(2)
    await hydrated(page)
  })

  test('signing in, the account and signing out work as before, and only the offline page is cached', async ({
    page,
    request,
    accountMenu,
    libraryPage,
    loginPage,
  }) => {
    const user = await createUser(request)
    await libraryPage.goto()
    await controlled(page)
    await loginPage.signIn(user)
    await expect(page).toHaveURL(/\/library$/)
    await page.goto('/account')
    await expect(page.getByRole('heading', { level: 1, name: user.username })).toBeVisible()
    await libraryPage.goto()
    await accountMenu.signOut(user.username)
    await expect(page).toHaveURL(/\/library$/)
    await hydrated(page)
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()

    const cached = await page.evaluate(async () => {
      const keys = await caches.keys()
      const requests = await Promise.all(keys.map(async (k) => (await caches.open(k)).keys()))
      return { keys, urls: requests.flat().map((r) => new URL(r.url).pathname) }
    })
    expect(cached).toEqual({ keys: ['folio-offline-v2'], urls: ['/offline.html'] })
  })
})
