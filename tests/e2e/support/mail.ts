import { type APIRequestContext, expect } from '@playwright/test'

export interface CapturedMail {
  to: string
  from: string
  subject: string
  text: string
  kind: string
  at: string
}

export async function mailTo(request: APIRequestContext, to: string): Promise<CapturedMail[]> {
  const response = await request.get(`/test-mail/messages?to=${encodeURIComponent(to)}`)
  expect(response.ok()).toBe(true)
  return response.json()
}

export async function latestLink(request: APIRequestContext, to: string, path: string): Promise<string> {
  let link = ''
  await expect
    .poll(
      async () => {
        const [newest] = await mailTo(request, to)
        const found = newest?.text.match(/https?:\/\/\S+/g)?.find((url) => new URL(url).pathname === path)
        link = found ? `${new URL(found).pathname}${new URL(found).search}` : ''
        return link
      },
      { timeout: 5_000 },
    )
    .not.toBe('')
  return link
}
