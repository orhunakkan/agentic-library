import type { APIRequestContext } from '@playwright/test'
import { createUser, type TestUser } from '../support/accounts'
import { expect, expectAccessible, expectNoSideways, test } from '../support/fixtures'
import { hydrated } from '../support/settle'

interface Made {
  token: string
  tokenType: string
  expiresAt: string
  id: string
  name: string
}

async function makeToken(request: APIRequestContext, user: TestUser, name = 'API tests'): Promise<Made> {
  const response = await request.post('/api/tokens', {
    data: { username: user.username, password: user.password, name, expiresInDays: 1 },
  })
  expect(response.status()).toBe(201)
  expect(response.headers()['cache-control']).toBe('private, no-store')
  return response.json()
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

test.describe('Access tokens', () => {
  test('a client makes a token, manages a shelf with it, revokes it and is signed out', { tag: '@http' }, async ({
    request,
  }) => {
    const user = await createUser(request)
    const made = await makeToken(request, user)
    expect(made.tokenType).toBe('Bearer')
    expect(made.token).toMatch(/^folio_at_[A-Za-z0-9_-]{43}$/)
    const headers = bearer(made.token)

    const me = await request.get('/api/me', { headers })
    expect(me.status()).toBe(200)
    expect(await me.json()).toEqual({ username: user.username, role: 'member', plan: 'pro', via: 'token' })

    const shelf = await request.post('/account/shelves/new', { headers, data: { name: 'To read' } })
    expect(shelf.status()).toBe(201)
    const { id } = ((await shelf.json()) as { shelf: { id: string } }).shelf
    const renamed = await request.post(`/account/shelves/${id}`, { headers, data: { name: 'Later' } })
    expect(((await renamed.json()) as { shelf: { name: string } }).shelf.name).toBe('Later')
    const deleted = await request.post(`/account/shelves/${id}`, { headers, data: { intent: 'delete' } })
    expect(await deleted.json()).toEqual({ deleted: true })

    const list = await request.get('/api/tokens', { headers })
    const { tokens } = (await list.json()) as { tokens: { id: string; name: string; current: boolean }[] }
    expect(tokens).toEqual([expect.objectContaining({ id: made.id, name: 'API tests', current: true })])

    const revoked = await request.post('/api/tokens/current', { headers, data: { intent: 'revoke' } })
    expect(await revoked.json()).toEqual({ revoked: true })
    const after = await request.get('/api/me', { headers })
    expect(after.status()).toBe(401)
    expect(after.headers()['www-authenticate']).toBe('Bearer error="invalid_token"')
    expect(await after.json()).toEqual({ error: 'signed_out' })
  })

  test('the account page lists a token and Revoke ends it', async ({ page, request, accountPage }) => {
    const user = await createUser(page.request, { signedIn: true })
    await accountPage.goto()
    await hydrated(page)
    const section = accountPage.accessTokens
    await expect(section.getByText('You have no access tokens.')).toBeVisible()

    const made = await makeToken(request, user, 'CI runner')
    await accountPage.goto()
    await hydrated(page)
    const item = section.getByRole('listitem').filter({ hasText: 'CI runner' })
    await expect(item).toContainText('Never used')
    await expect(item).toContainText('Expires')
    await section.scrollIntoViewIfNeeded()
    await expectAccessible(page)
    await expectNoSideways(page)

    await item.getByRole('button', { name: /^Revoke CI runner/ }).click()
    await expect(page).toHaveURL(/status=token-revoked/)
    await expect(section.getByRole('status')).toHaveText('Access token revoked.')
    await expect(section.getByText('You have no access tokens.')).toBeVisible()
    expect((await request.get('/api/me', { headers: bearer(made.token) })).status()).toBe(401)
  })
})
