import '@tanstack/react-start/server-only'
import { readCapped } from '../json-body.ts'
import { logError } from '../redact.ts'
import type { Message } from './messages.ts'

export type SendResult = 'sent' | 'invalid' | 'busy' | 'unavailable'

export interface OutgoingMail extends Message {
  to: string
}

export interface ResendSettings {
  from: string
  apiKey: string
  apiBase: string
}

const TIMEOUT_MS = 10_000
const MAX_ANSWER = 16 * 1024

function errorName(answer: string): string {
  try {
    const name = (JSON.parse(answer) as { name?: unknown }).name
    return typeof name === 'string' && /^[a-z_]{1,60}$/.test(name) ? name : 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function sendWithResend(
  settings: ResendSettings,
  mail: OutgoingMail,
  { fetch: fetchImpl = globalThis.fetch }: { fetch?: typeof fetch } = {},
): Promise<SendResult> {
  const fail = (result: Exclude<SendResult, 'sent'>, why: string): SendResult => {
    logError('mail', `${mail.kind} through Resend: ${result} (${why})`)
    return result
  }
  let response: Response
  try {
    response = await fetchImpl(`${settings.apiBase}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${settings.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: settings.from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        tags: [{ name: 'kind', value: mail.kind }],
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    return fail('unavailable', error instanceof Error ? error.name : 'request failed')
  }
  let answer: Buffer | null
  try {
    answer = await readCapped(response, MAX_ANSWER)
  } catch (error) {
    return fail('unavailable', error instanceof Error ? error.name : 'answer failed')
  }
  if (answer === null) return fail('unavailable', `${response.status} answer over 16 KB`)
  if (response.status === 200) return 'sent'
  const why = `${response.status} ${errorName(answer.toString('utf8'))}`
  if (response.status === 400 || response.status === 422) return fail('invalid', why)
  if (response.status === 429) return fail('busy', why)
  return fail('unavailable', why)
}
