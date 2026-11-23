import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPlanState, openPortal, startCheckout } from './billing-client'

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

const CHECKOUT = { transactionId: 'txn_01abc', clientToken: 'test_123', env: 'sandbox', email: 'ada@example.com' }

describe('startCheckout', () => {
  it('posts only the cadence, and answers the transaction', async () => {
    const fetch = answer(200, CHECKOUT)
    expect(await startCheckout('year')).toEqual({ ok: true, value: CHECKOUT })
    expect(fetch).toHaveBeenCalledWith('/account/plan/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cadence: 'year' }),
    })
    answer(200, { ...CHECKOUT, email: null })
    expect(await startCheckout('month')).toEqual({ ok: true, value: { ...CHECKOUT, email: null } })
  })

  it('maps each refusal to its problem, and anything else to failed', async () => {
    for (const code of ['subscribed', 'pro', 'signed_out', 'not_found', 'invalid'] as const) {
      answer(409, { error: code })
      expect(await startCheckout('year')).toEqual({ ok: false, problem: code })
    }
    answer(502, { error: 'failed' })
    expect(await startCheckout('year')).toEqual({ ok: false, problem: 'failed' })
    answer(403, 'Forbidden')
    expect(await startCheckout('year')).toEqual({ ok: false, problem: 'failed' })
    answer(200, { ...CHECKOUT, env: 'staging' })
    expect(await startCheckout('year')).toEqual({ ok: false, problem: 'failed' })
    answer(200, { clientToken: 'test_1', env: 'sandbox' })
    expect(await startCheckout('year')).toEqual({ ok: false, problem: 'failed' })
  })

  it('says network when the request never arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    expect(await startCheckout('month')).toEqual({ ok: false, problem: 'network' })
  })
})

describe('openPortal', () => {
  it('answers the portal’s address', async () => {
    const fetch = answer(200, { url: 'https://customer-portal.paddle.com/cpl_01' })
    expect(await openPortal()).toEqual({ ok: true, value: 'https://customer-portal.paddle.com/cpl_01' })
    expect(fetch).toHaveBeenCalledWith('/account/plan/portal', expect.objectContaining({ method: 'POST' }))
    answer(404, { error: 'not_found' })
    expect(await openPortal()).toEqual({ ok: false, problem: 'not_found' })
    answer(200, {})
    expect(await openPortal()).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('fetchPlanState', () => {
  it('reads the state, uncached', async () => {
    const state = { billing: true, plan: 'pro', source: 'paid', subscription: null, foundingLeft: 99 }
    const fetch = answer(200, state)
    expect(await fetchPlanState()).toEqual(state)
    expect(fetch).toHaveBeenCalledWith('/account/plan/state', { cache: 'no-store' })
  })

  it('is null when it can’t be read', async () => {
    answer(401, { error: 'signed_out' })
    expect(await fetchPlanState()).toBeNull()
    answer(200, { plan: 'gold' })
    expect(await fetchPlanState()).toBeNull()
    answer(200, 'not json')
    expect(await fetchPlanState()).toBeNull()
  })
})
