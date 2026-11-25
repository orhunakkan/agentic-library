import '@tanstack/react-start/server-only'
import { getConfig } from '../config.ts'
import { getDb } from '../db.ts'
import { readCapped } from '../json-body.ts'
import { logError } from '../redact.ts'
import { verifyPaddleSignature } from './signature.ts'
import { recordPaddleEvent, recordStatusChange, upsertFromPaddle } from './store.ts'
import { isWebhookEvent, parsePaddleEvent, subscriptionRow } from './webhook-input.ts'

export const MAX_WEBHOOK_BYTES = 64 * 1024

const answer = (status: number, text: string) =>
  new Response(text, { status, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } })

export async function handlePaddleEvent(request: Request, now = new Date()): Promise<Response> {
  const billing = getConfig().billing
  if (!billing) return answer(404, 'Not found')
  const bytes = await readCapped(request, MAX_WEBHOOK_BYTES)
  if (!bytes) return answer(413, 'Too large')
  const body = bytes.toString('utf8')
  const check = verifyPaddleSignature(request.headers.get('paddle-signature'), body, billing.webhookSecret, now)
  if (check.result !== 'ok') {
    console.warn(
      check.result === 'stale'
        ? `[paddle webhook] refused: the signature is ${check.offBySeconds} s off the server's clock`
        : `[paddle webhook] refused: ${check.result}`,
    )
    return answer(401, 'Bad signature')
  }
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return answer(400, 'Not JSON')
  }
  const event = parsePaddleEvent(value)
  if (!event) return answer(400, 'Not an event')
  if (!isWebhookEvent(event.eventType)) return answer(200, 'Ignored')

  const mapped = event.eventType.startsWith('subscription.')
    ? subscriptionRow(event.data, billing.prices, event.occurredAt)
    : null
  if (mapped && !mapped.ok) {
    if (mapped.reason === 'unknown_status') {
      logError('paddle webhook', new Error(`subscription status "${mapped.status}" isn't in the subscriptions check`))
      return answer(500, 'Unknown status')
    }
    console.warn(`[paddle webhook] ${event.eventType} ${event.eventId}: not a subscription Folio can read`)
    return answer(400, 'Not a subscription')
  }

  try {
    const outcome = await getDb().begin(async (tx) => {
      if (!(await recordPaddleEvent(tx, event))) return 'repeat'
      if (!mapped) return 'recorded'
      const result = await upsertFromPaddle(tx, mapped.row)
      if (result.unknownUser)
        console.warn(`[paddle webhook] ${mapped.row.id} names an account that doesn't exist; kept without one`)
      await recordStatusChange(tx, result, mapped.row.id, 'paddle')
      return result.applied ? 'applied' : 'older'
    })
    return answer(200, outcome === 'repeat' ? 'Already recorded' : 'Recorded')
  } catch (error) {
    logError('paddle webhook', error)
    return answer(500, 'Failed')
  }
}
