import type { BrowserContext } from '@playwright/test'

export async function useVirtualAuthenticator(context: BrowserContext) {
  await context.credentials.install()
  return context.credentials
}
