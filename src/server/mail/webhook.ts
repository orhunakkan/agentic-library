import '@tanstack/react-start/server-only'
import { getConfig } from '../config.ts'
import { getDb } from '../db.ts'
import { markBounced } from '../email/store.ts'
import { readCapped } from '../json-body.ts'
import { logError } from '../redact.ts'
import { mailAvailable } from './mail.ts'
import { verifySvixSignature } from './signature.ts'
import { parseMailEvent } from './webhook-input.ts'

export const MAX_EVENT_BYTES = 16 * 1024

const answer = (status: number, text: string) =>
  new Response(text, { status, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } })

export async function handleMailEvent(request: Request, now = new Date()): Promise<Response> {
  const key = getConfig().mailWebhookKey
  if (!key || !mailAvailable()) return answer(404, 'Not found')
  const bytes = await readCapped(request, MAX_EVENT_BYTES)
  if (!bytes) return answer(413, 'Too large')
  const body = bytes.toString('utf8')
  const check = verifySvixSignature({
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
    body,
    key,
    now,
  })
  if (check !== 'ok') return answer(401, 'Bad signature')
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return answer(400, 'Not JSON')
  }
  const event = parseMailEvent(value)
  if (!event) return answer(200, 'Ignored')
  try {
    for (const email of event.to) await markBounced(getDb(), email, event.kind)
    return answer(200, 'Marked')
  } catch (error) {
    logError('mail event', error)
    return answer(500, 'Failed')
  }
}
