import { initializePaddle } from '@paddle/paddle-js'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page } from 'vitest/browser'
import { mountAt } from '~/client/testing/router'
import type { PlanState } from '~/shared/billing/billing'
import { ProPage } from './ProPage'

/** Paddle.js is faked where use-checkout loads it, so nothing reaches cdn.paddle.com. */
vi.mock('@paddle/paddle-js', () => ({ initializePaddle: vi.fn() }))

const FREE: PlanState = { billing: true, plan: 'free', source: 'free', subscription: null, foundingLeft: 0 }

const CHECKOUT = { transactionId: 'txn_01test', clientToken: 'test_client_token', env: 'sandbox', email: null }

/** The server's answer to the checkout, as the E2E test's page.route gave it. */
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const buyButton = page.getByRole('button', { name: /^Go Pro, / })
const alert = page.getByRole('alert')

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
  vi.mocked(initializePaddle).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProPage checkout', () => {
  it('says a refused checkout, then a Paddle.js that won’t load, under the button', async () => {
    fetchSpy.mockResolvedValueOnce(answer(409, { error: 'subscribed' })).mockResolvedValueOnce(answer(200, CHECKOUT))
    vi.mocked(initializePaddle).mockResolvedValue(undefined)
    await mountAt('/pro', <ProPage initial={FREE} />)

    await buyButton.click()
    await expect.element(alert).toHaveTextContent('You already have Pro.')
    await expect.element(buyButton).toBeEnabled()
    expect(initializePaddle).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledWith('/account/plan/checkout', expect.objectContaining({ method: 'POST' }))

    await buyButton.click()
    await expect.element(alert).toHaveTextContent('Couldn’t open the checkout. Try again in a moment.')
    await expect.element(buyButton).toBeEnabled()
    expect(initializePaddle).toHaveBeenCalledOnce()
  })

  it('says so when Paddle.js fails as it loads', async () => {
    fetchSpy.mockResolvedValue(answer(200, CHECKOUT))
    vi.mocked(initializePaddle).mockRejectedValue(new Error('blocked'))
    await mountAt('/pro', <ProPage initial={FREE} />)

    await buyButton.click()
    await expect.element(alert).toHaveTextContent('Couldn’t open the checkout. Try again in a moment.')
    await expect.element(buyButton).toBeEnabled()
  })
})
