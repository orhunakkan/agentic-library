import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { hydrated } from './settle'

export { SEEDED } from './seed.ts'

export interface TestUser {
  username: string
  password: string
}

export async function createUser(
  request: APIRequestContext,
  {
    role = 'member',
    signedIn = false,
    plan = 'pro',
  }: { role?: 'admin' | 'member'; signedIn?: boolean; plan?: 'free' | 'pro' } = {},
): Promise<TestUser> {
  const response = await request.post('/test-users', { data: { role, signedIn, plan } })
  if (!response.ok()) throw new Error(`/test-users answered ${response.status()}`)
  return response.json()
}

export async function signedInAt(page: Page, next = '/library'): Promise<TestUser> {
  const user = await createUser(page.request, { signedIn: true })
  await page.goto(next)
  await hydrated(page)
  return user
}

const appOrigin = () => new URL(String(test.info().project.use.baseURL)).origin

export async function signInOverHttp(request: APIRequestContext, user: TestUser): Promise<void> {
  const response = await request.post('/login', {
    form: { username: user.username, password: user.password },
    headers: { origin: appOrigin() },
    maxRedirects: 0,
  })
  expect(response.status(), 'sign-in answers 303').toBe(303)
  expect(response.headers().location ?? '', 'sign-in succeeded').not.toContain('error=')
}

export const validKey = (suffix: string) => `sk-ant-test-valid-${'x'.repeat(16)}${suffix}`

async function postApiKeys(page: Page, form: Record<string, string>, status: string) {
  const response = await page.request.post('/account/api-keys', {
    form,
    headers: { origin: appOrigin() },
    maxRedirects: 0,
  })
  expect(response.headers().location).toContain(`status=${status}`)
}

export async function saveKey(
  page: Page,
  key = validKey('0000'),
  provider: 'anthropic' | 'openai' | 'elevenlabs' = 'anthropic',
) {
  await postApiKeys(page, { intent: 'save', provider, key }, 'saved')
}

export async function chooseModel(page: Page, model: string) {
  await postApiKeys(page, { intent: 'model', model }, 'model-saved')
}
