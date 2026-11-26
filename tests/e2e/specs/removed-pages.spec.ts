import { createUser } from '../support/accounts'
import { expect, test } from '../support/fixtures'

/** The pages and routes billing had. They answer 404 like any unknown path, with no redirect (spec/SPEC-billing-removal.md). */
const REMOVED = ['/account/plan', '/refunds', '/billing/paddle']

test.describe('Removed billing pages', () => {
  test('answer 404 signed out and signed in, with the not-found page and no redirect', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A status and a page; the layout adds nothing.')
    for (const signedIn of [false, true]) {
      if (signedIn) await createUser(page.request, { signedIn: true })
      for (const path of REMOVED) {
        const response = await page.goto(path)
        expect([signedIn, path, response?.status()]).toEqual([signedIn, path, 404])
        expect(new URL(page.url()).pathname).toBe(path)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page isn’t on our shelves')
      }
    }
    const webhook = await page.request.post('/billing/paddle', { data: {}, maxRedirects: 0 })
    expect(webhook.status()).toBe(404)
  })
})
