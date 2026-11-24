/** What a change sent to a JSON endpoint came to: its value, or the problem that stopped it. */
export type ChangeResult<T, P extends string> = { ok: true; value: T } | { ok: false; problem: P }

/** The problems `readAnswer` knows, for the features that read their answers with it. */
export type AnswerProblem =
  | 'quota-book'
  | 'quota-user'
  | 'quota-free'
  | 'pro'
  | 'stale'
  | 'signed_out'
  | 'not_found'
  | 'failed'

export function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

const fail = (problem: AnswerProblem) => ({ ok: false, problem }) as const

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
