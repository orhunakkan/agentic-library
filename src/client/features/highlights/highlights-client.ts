import type { HighlightColor } from '~/shared/highlights/colors'
import type { HighlightView } from '~/shared/highlights/group'
import type { PagePosition } from '~/shared/highlights/page-text'

export type HighlightProblem =
  | 'quota-book'
  | 'quota-user'
  | 'quota-free'
  | 'pro'
  | 'stale'
  | 'signed_out'
  | 'not_found'
  | 'failed'

export type ChangeResult<T, P extends string = HighlightProblem> = { ok: true; value: T } | { ok: false; problem: P }

export interface NewHighlightRequest {
  book: string
  position: PagePosition
  start: number
  end: number
  text: string
  color: HighlightColor
  note?: string | null
}

export async function readAnswer<T>(response: Response, pick: (body: Record<string, unknown>) => T | undefined) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) {
    const value = pick(body)
    return value === undefined ? fail('failed') : ({ ok: true, value } as const)
  }
  if (body.error === 'quota' && body.plan === 'free') return fail('quota-free')
  if (body.error === 'quota') return fail(body.scope === 'user' ? 'quota-user' : 'quota-book')
  if (response.status === 403 && body.error === 'pro') return fail('pro')
  if (body.error === 'stale' || body.error === 'signed_out' || body.error === 'not_found') return fail(body.error)
  return fail('failed')
}

const fail = (problem: HighlightProblem) => ({ ok: false, problem }) as const

export function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

const highlightOf = (body: Record<string, unknown>) =>
  body.highlight && typeof body.highlight === 'object' ? (body.highlight as HighlightView) : undefined

async function send<T>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<ChangeResult<T>> {
  try {
    return await readAnswer(await post(path, body), pick)
  } catch {
    return fail('failed')
  }
}

export function createHighlight(request: NewHighlightRequest): Promise<ChangeResult<HighlightView>> {
  return send('/account/highlights/new', request, highlightOf)
}

export function updateHighlight(
  id: string,
  change: { color?: HighlightColor; note?: string | null },
): Promise<ChangeResult<HighlightView>> {
  return send(`/account/highlights/${encodeURIComponent(id)}`, { intent: 'update', ...change }, highlightOf)
}

export function deleteHighlight(id: string): Promise<ChangeResult<true>> {
  return send(`/account/highlights/${encodeURIComponent(id)}`, { intent: 'delete' }, (b) =>
    b.ok === true ? true : undefined,
  )
}
