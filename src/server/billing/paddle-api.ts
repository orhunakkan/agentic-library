import '@tanstack/react-start/server-only'
import { type BillingConfig, getConfig } from '../config.ts'
import { readCapped } from '../json-body.ts'

const TIMEOUT_MS = 10_000
const MAX_ANSWER_BYTES = 4 * 1024 * 1024
const LIST_PAGE = 200
const MAX_PAGES = 500

export interface PaddleOptions {
  fetch?: typeof fetch
  config?: BillingConfig
}

export class PaddleApiError extends Error {
  name = 'PaddleApiError'
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null) {
    super(status === 401 ? 'Paddle API key rejected' : `Paddle API ${status || 'unreachable'}${code ? ` ${code}` : ''}`)
    this.status = status
    this.code = code
  }
}

const SUBSCRIPTION_ID = /^sub_[a-z0-9]{4,60}$/
const CUSTOMER_ID = /^ctm_[a-z0-9]{4,60}$/
const TRANSACTION_ID = /^txn_[a-z0-9]{4,60}$/
const PRICE_ID = /^pri_[a-z0-9]{4,60}$/

const isSubscriptionId = (id: unknown): id is string => typeof id === 'string' && SUBSCRIPTION_ID.test(id)
const isCustomerId = (id: unknown): id is string => typeof id === 'string' && CUSTOMER_ID.test(id)

function settings(options: PaddleOptions): BillingConfig {
  const config = options.config ?? getConfig().billing
  if (!config) throw new PaddleApiError(0, 'billing_off')
  return config
}

interface Envelope {
  data: unknown
  meta: unknown
}

async function call(method: 'GET' | 'POST', path: string, body: object | null, options: PaddleOptions) {
  const config = settings(options)
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(`${config.apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        'paddle-version': '1',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })
  } catch {
    throw new PaddleApiError(0, null)
  }
  const bytes = await readCapped(response, MAX_ANSWER_BYTES).catch(() => null)
  let value: unknown = null
  try {
    value = bytes ? JSON.parse(bytes.toString('utf8')) : null
  } catch {
    value = null
  }
  const envelope = value && typeof value === 'object' ? (value as Partial<Envelope> & { error?: unknown }) : {}
  if (!response.ok) {
    const error = envelope.error && typeof envelope.error === 'object' ? (envelope.error as { code?: unknown }) : {}
    throw new PaddleApiError(response.status, typeof error.code === 'string' ? error.code.slice(0, 80) : null)
  }
  if (!('data' in envelope)) throw new PaddleApiError(response.status, 'no_data')
  return { data: envelope.data, meta: envelope.meta } as Envelope
}

const field = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined

export async function createTransaction(priceId: string, userId: number, options: PaddleOptions = {}): Promise<string> {
  if (!PRICE_ID.test(priceId)) throw new PaddleApiError(0, 'bad_price')
  const { data } = await call(
    'POST',
    '/transactions',
    { items: [{ price_id: priceId, quantity: 1 }], custom_data: { folio_user: String(userId) } },
    options,
  )
  const id = field(data, 'id')
  if (typeof id !== 'string' || !TRANSACTION_ID.test(id)) throw new PaddleApiError(200, 'no_transaction')
  return id
}

export async function getSubscription(id: string, options: PaddleOptions = {}): Promise<unknown> {
  if (!isSubscriptionId(id)) throw new PaddleApiError(0, 'bad_id')
  return (await call('GET', `/subscriptions/${id}`, null, options)).data
}

export async function listSubscriptions(options: PaddleOptions = {}): Promise<unknown[]> {
  const all: unknown[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ per_page: String(LIST_PAGE), ...(after ? { after } : {}) })
    const { data, meta } = await call('GET', `/subscriptions?${query}`, null, options)
    if (!Array.isArray(data)) throw new PaddleApiError(200, 'not_a_list')
    all.push(...data)
    const last = field(data.at(-1), 'id')
    if (field(field(meta, 'pagination'), 'has_more') !== true || !isSubscriptionId(last)) return all
    after = last
  }
  throw new PaddleApiError(200, 'too_many_pages')
}

export async function cancelNow(id: string, options: PaddleOptions = {}): Promise<void> {
  if (!isSubscriptionId(id)) throw new PaddleApiError(0, 'bad_id')
  await call('POST', `/subscriptions/${id}/cancel`, { effective_from: 'immediately' }, options)
}

export async function portalSession(
  customerId: string,
  subscriptionId: string,
  options: PaddleOptions = {},
): Promise<string> {
  if (!isCustomerId(customerId) || !isSubscriptionId(subscriptionId)) throw new PaddleApiError(0, 'bad_id')
  const { data } = await call(
    'POST',
    `/customers/${customerId}/portal-sessions`,
    { subscription_ids: [subscriptionId] },
    options,
  )
  const url = field(field(field(data, 'urls'), 'general'), 'overview')
  if (typeof url !== 'string') throw new PaddleApiError(200, 'no_url')
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.origin === new URL(settings(options).apiBase).origin) return url
  } catch {}
  throw new PaddleApiError(200, 'bad_url')
}
