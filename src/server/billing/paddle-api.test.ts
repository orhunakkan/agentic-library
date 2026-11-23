import { describe, expect, it } from 'vitest'
import type { BillingConfig } from '../config'
import {
  cancelNow,
  createTransaction,
  getSubscription,
  listSubscriptions,
  PaddleApiError,
  portalSession,
} from './paddle-api'

const config: BillingConfig = {
  env: 'sandbox',
  apiBase: 'https://sandbox-api.paddle.test',
  apiKey: 'pdl_sdbx_apikey_testtesttesttesttest',
  webhookSecret: 'pdl_ntfset_testtesttest',
  clientToken: 'test_0123456789',
  prices: { monthly: 'pri_01month', yearly: 'pri_01year', founding: 'pri_01found' },
}

interface Seen {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
  redirect: RequestRedirect | undefined
}

function paddle(...answers: (Response | Error)[]) {
  const seen: Seen[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      method: init?.method ?? 'GET',
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      redirect: init?.redirect,
    })
    const answer = answers.shift()
    if (!answer) throw new Error('no more answers')
    if (answer instanceof Error) throw answer
    return answer
  }) as typeof globalThis.fetch
  return { seen, options: { fetch, config } }
}

const ok = (data: unknown, meta: unknown = {}) => Response.json({ data, meta })
const refused = (status: number, code: string) =>
  Response.json({ error: { type: 'request_error', code, detail: 'no' }, meta: { request_id: 'r' } }, { status })

describe('createTransaction', () => {
  it('posts the price and the account, with the key as a Bearer token and no redirects', async () => {
    const { seen, options } = paddle(ok({ id: 'txn_01abc', status: 'ready' }))
    expect(await createTransaction('pri_01year', 42, options)).toBe('txn_01abc')
    expect(seen).toEqual([
      {
        method: 'POST',
        url: 'https://sandbox-api.paddle.test/transactions',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          'paddle-version': '1',
        },
        body: { items: [{ price_id: 'pri_01year', quantity: 1 }], custom_data: { folio_user: '42' } },
        redirect: 'error',
      },
    ])
  })

  it('refuses an answer without a transaction id, and a malformed price before calling', async () => {
    await expect(createTransaction('pri_01year', 1, paddle(ok({ id: 'nope' })).options)).rejects.toThrow(PaddleApiError)
    const none = paddle()
    await expect(createTransaction('price_1', 1, none.options)).rejects.toThrow(PaddleApiError)
    expect(none.seen).toEqual([])
  })
})

describe('a failed call', () => {
  it('carries Paddle’s status and code, and says so plainly for a rejected key', async () => {
    const error = await createTransaction('pri_01year', 1, paddle(refused(401, 'authentication_failed')).options).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(PaddleApiError)
    expect(error).toMatchObject({ status: 401, code: 'authentication_failed', message: 'Paddle API key rejected' })
    expect(String((error as Error).stack)).not.toContain(config.apiKey)
    await expect(cancelNow('sub_01abc', paddle(refused(400, 'subscription_locked')).options)).rejects.toMatchObject({
      status: 400,
      code: 'subscription_locked',
      message: 'Paddle API 400 subscription_locked',
    })
  })

  it('is status 0 when the network fails, with nothing of the request in it', async () => {
    const cause = new Error(`fetch failed: authorization: Bearer ${config.apiKey}`)
    const error = await getSubscription('sub_01abc', paddle(cause).options).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 0, code: null, message: 'Paddle API unreachable' })
    expect(JSON.stringify(error)).not.toContain(config.apiKey)
  })

  it('is refused when the answer isn’t Paddle’s envelope', async () => {
    await expect(getSubscription('sub_01abc', paddle(new Response('<html>')).options)).rejects.toMatchObject({
      code: 'no_data',
    })
    await expect(
      getSubscription('sub_01abc', paddle(new Response('oops', { status: 502 })).options),
    ).rejects.toMatchObject({ status: 502, code: null })
  })

  it('needs billing to be on', async () => {
    await expect(getSubscription('sub_01abc', { config: undefined })).rejects.toMatchObject({ code: 'billing_off' })
  })
})

describe('getSubscription and cancelNow', () => {
  it('read one subscription and cancel it at once', async () => {
    const { seen, options } = paddle(ok({ id: 'sub_01abc', status: 'active' }), ok({ id: 'sub_01abc' }))
    expect(await getSubscription('sub_01abc', options)).toEqual({ id: 'sub_01abc', status: 'active' })
    await cancelNow('sub_01abc', options)
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      ['GET', 'https://sandbox-api.paddle.test/subscriptions/sub_01abc', null],
      ['POST', 'https://sandbox-api.paddle.test/subscriptions/sub_01abc/cancel', { effective_from: 'immediately' }],
    ])
  })

  it('refuse an id that isn’t Paddle’s before calling', async () => {
    const { seen, options } = paddle()
    await expect(getSubscription('../customers', options)).rejects.toMatchObject({ code: 'bad_id' })
    await expect(cancelNow('sub_X/../', options)).rejects.toMatchObject({ code: 'bad_id' })
    expect(seen).toEqual([])
  })
})

describe('listSubscriptions', () => {
  it('follows the pages until there are no more', async () => {
    const page = (ids: string[], more: boolean) =>
      ok(
        ids.map((id) => ({ id })),
        { pagination: { has_more: more } },
      )
    const { seen, options } = paddle(page(['sub_01aaaa', 'sub_01bbbb'], true), page(['sub_01cccc'], false))
    expect(await listSubscriptions(options)).toEqual([{ id: 'sub_01aaaa' }, { id: 'sub_01bbbb' }, { id: 'sub_01cccc' }])
    expect(seen.map((s) => s.url)).toEqual([
      'https://sandbox-api.paddle.test/subscriptions?per_page=200',
      'https://sandbox-api.paddle.test/subscriptions?per_page=200&after=sub_01bbbb',
    ])
  })

  it('gives up after 500 pages rather than follow Paddle forever', async () => {
    let n = 0
    const fetch = (async () =>
      Response.json({
        data: [{ id: `sub_01page${String(++n).padStart(4, '0')}` }],
        meta: { pagination: { has_more: true } },
      })) as unknown as typeof globalThis.fetch
    await expect(listSubscriptions({ fetch, config })).rejects.toMatchObject({ code: 'too_many_pages' })
    expect(n).toBe(500)
  })

  it('stops on an empty page, and refuses an answer that isn’t a list', async () => {
    expect(await listSubscriptions(paddle(ok([], { pagination: { has_more: true } })).options)).toEqual([])
    await expect(listSubscriptions(paddle(ok({ id: 'sub_01aaaa' })).options)).rejects.toMatchObject({
      code: 'not_a_list',
    })
  })
})

describe('portalSession', () => {
  it('answers the portal’s overview for the subscription', async () => {
    const overview = 'https://customer-portal.paddle.com/cpl_01abc?action=overview&token=x'
    const { seen, options } = paddle(ok({ id: 'cpls_01', urls: { general: { overview } } }))
    expect(await portalSession('ctm_01abc', 'sub_01abc', options)).toBe(overview)
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      [
        'POST',
        'https://sandbox-api.paddle.test/customers/ctm_01abc/portal-sessions',
        { subscription_ids: ['sub_01abc'] },
      ],
    ])
  })

  it('takes the stub’s address on the API’s own origin, and refuses any other non-https one', async () => {
    const local = { ...config, apiBase: 'http://127.0.0.1:3100/test-paddle' }
    const stub = 'http://127.0.0.1:3100/test-paddle/portal/ctm_01abc'
    const at = (url: unknown, c = config) => {
      const { options } = paddle(ok({ urls: { general: { overview: url } } }))
      return portalSession('ctm_01abc', 'sub_01abc', { ...options, config: c })
    }
    expect(await at(stub, local)).toBe(stub)
    await expect(at(stub)).rejects.toMatchObject({ code: 'bad_url' })
    await expect(at('javascript:alert(1)')).rejects.toMatchObject({ code: 'bad_url' })
    await expect(at('not a url')).rejects.toMatchObject({ code: 'bad_url' })
    await expect(at(undefined)).rejects.toMatchObject({ code: 'no_url' })
    await expect(portalSession('cus_1', 'sub_01abc', paddle().options)).rejects.toMatchObject({ code: 'bad_id' })
  })
})
