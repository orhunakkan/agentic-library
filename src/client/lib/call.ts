import type { Endpoint, ErrorAnswer } from '~/shared/lib/endpoint'
import { isObject } from '~/shared/lib/json-shape'
import { post } from './post'

/** Why a call got no answer from the endpoint: the request never arrived, or what came back was not JSON. */
export type CallFailure = { error: 'offline' } | { error: 'failed' }

export type Called<A, R extends ErrorAnswer> = { ok: true; answer: A } | { ok: false; refusal: R | CallFailure }

/**
 * Posts a body to a JSON endpoint and reads its answer or refusal by the endpoint's types. It trusts
 * them without checking, as the answer comes from the same origin; it only refuses what isn't JSON.
 */
export async function call<B, A, R extends ErrorAnswer>(
  endpoint: Endpoint<B, unknown, A, R>,
  body: B,
): Promise<Called<A, R>> {
  let response: Response
  try {
    response = await post(endpoint.path, body)
  } catch {
    return { ok: false, refusal: { error: 'offline' } }
  }
  const read: unknown = await response.json().catch(() => null)
  if (!isObject(read)) return { ok: false, refusal: { error: 'failed' } }
  if (response.ok) return { ok: true, answer: read as A }
  return typeof read.error === 'string'
    ? { ok: false, refusal: read as R }
    : { ok: false, refusal: { error: 'failed' } }
}
