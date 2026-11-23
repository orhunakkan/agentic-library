import '@tanstack/react-start/server-only'
import { getConfig } from '../config.ts'
import type { Db } from '../db.ts'
import { logError } from '../redact.ts'
import { captureMail } from './capture.ts'
import { type OutgoingMail, type SendResult, sendWithResend } from './resend.ts'

export type MailResult = SendResult | 'off' | 'skipped'

export function mailAvailable(): boolean {
  const config = getConfig()
  return config.mail !== null && config.databaseUrl !== null
}

export async function isMarkedBounced(db: Db, email: string): Promise<boolean> {
  const rows = await db`
    select 1 from users where lower(email) = lower(${email}) and email_bounced_at is not null limit 1`
  return rows.length > 0
}

export async function sendMail(
  db: Db,
  mail: OutgoingMail,
  options: { fetch?: typeof fetch } = {},
): Promise<MailResult> {
  const config = getConfig().mail
  if (!config) return 'off'
  try {
    if (mail.kind !== 'confirm' && (await isMarkedBounced(db, mail.to))) return 'skipped'
    if (config.transport === 'capture') {
      await captureMail(config.dir, config.from, mail)
      return 'sent'
    }
    return await sendWithResend(config, mail, options)
  } catch (error) {
    logError('mail', `${mail.kind}: unavailable (${error instanceof Error ? error.name : 'failed'})`)
    return 'unavailable'
  }
}
