import { randomBytes } from 'node:crypto'
import { paddleSignatureHeader } from '../../../src/server/billing/signature.ts'
import { paddleEvent, paddleSubscription } from '../../../src/server/testing/paddle.ts'

interface Transaction {
  priceId: string
  folioUser: string
}

const transactions = new Map<string, Transaction>()
const subscriptions = new Map<string, Record<string, unknown>>()

const id = (prefix: string) => `${prefix}_01e2e${randomBytes(8).toString('hex')}`
const data = (value: unknown, status = 200) =>
  Response.json({ data: value, meta: { request_id: 'e2e', pagination: { has_more: false } } }, { status })
const refuse = (status: number, code: string) =>
  Response.json({ error: { type: 'request_error', code, detail: 'refused by the e2e stub' } }, { status })

async function deliver(origin: string, secret: string, event: unknown): Promise<boolean> {
  const body = JSON.stringify(event)
  const response = await fetch(`${origin}/billing/paddle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'paddle-signature': paddleSignatureHeader(secret, body) },
    body,
  })
  return response.ok
}

export function paddleStub(origin: string, secret: string, prices: { founding: string }) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/test-paddle/, '')
    if (!path.startsWith('/complete/') && !path.startsWith('/portal/')) {
      if (!/^Bearer \S+$/.test(request.headers.get('authorization') ?? '')) return refuse(401, 'authentication_missing')
    }
    const body =
      request.method === 'POST' ? ((await request.json().catch(() => null)) as Record<string, unknown>) : null

    if (request.method === 'POST' && path === '/transactions') {
      const items = Array.isArray(body?.items) ? (body.items as { price_id?: unknown; quantity?: unknown }[]) : []
      const folioUser = (body?.custom_data as { folio_user?: unknown } | undefined)?.folio_user
      const [item] = items
      if (
        items.length !== 1 ||
        typeof item?.price_id !== 'string' ||
        item.quantity !== 1 ||
        typeof folioUser !== 'string'
      )
        return refuse(400, 'bad_request')
      const txn = id('txn')
      transactions.set(txn, { priceId: item.price_id, folioUser })
      return data({ id: txn, status: 'ready' }, 201)
    }

    const complete = /^\/complete\/(txn_[a-z0-9]+)$/.exec(path)
    if (request.method === 'POST' && complete?.[1]) {
      const transaction = transactions.get(complete[1])
      if (!transaction) return refuse(404, 'not_found')
      const subscription = paddleSubscription({
        id: id('sub'),
        customerId: id('ctm'),
        priceId: transaction.priceId,
        userId: transaction.folioUser,
        periodEndsAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      })
      subscriptions.set(subscription.id as string, subscription)
      const taken = await deliver(origin, secret, paddleEvent('subscription.created', subscription))
      return taken
        ? data({ subscription: subscription.id, founding: transaction.priceId === prices.founding })
        : refuse(502, 'webhook_refused')
    }

    const portal = /^\/customers\/(ctm_[a-z0-9]+)\/portal-sessions$/.exec(path)
    if (request.method === 'POST' && portal?.[1]) {
      if (!Array.isArray(body?.subscription_ids)) return refuse(400, 'bad_request')
      return data({ id: id('cpls'), urls: { general: { overview: `${origin}/test-paddle/portal/${portal[1]}` } } }, 201)
    }
    if (request.method === 'GET' && path.startsWith('/portal/'))
      return new Response(
        '<!doctype html><html lang="en"><head><title>Paddle portal (e2e stub)</title></head><body><main><h1>Paddle customer portal</h1></main></body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      )

    const one = /^\/subscriptions\/(sub_[a-z0-9]+)(\/cancel)?$/.exec(path)
    if (one?.[1]) {
      const subscription = subscriptions.get(one[1])
      if (!subscription) return refuse(404, 'not_found')
      if (request.method === 'POST' && one[2]) {
        if (body?.effective_from !== 'immediately') return refuse(400, 'bad_request')
        Object.assign(subscription, { status: 'canceled', canceled_at: new Date().toISOString() })
      }
      return data(subscription)
    }
    if (request.method === 'GET' && path === '/subscriptions') return data([...subscriptions.values()])

    return refuse(404, 'not_found')
  }
}
