import '@tanstack/react-start/server-only'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OutgoingMail } from './resend.ts'

export interface CapturedMail {
  to: string
  from: string
  subject: string
  text: string
  kind: string
  at: string
}

export async function captureMail(dir: string, from: string, mail: OutgoingMail, now = new Date()): Promise<string> {
  await mkdir(dir, { recursive: true })
  const at = now.toISOString()
  const path = join(dir, `${at.replaceAll(':', '-')}-${randomBytes(4).toString('hex')}.json`)
  const captured: CapturedMail = { to: mail.to, from, subject: mail.subject, text: mail.text, kind: mail.kind, at }
  await writeFile(path, `${JSON.stringify(captured, null, 2)}\n`, { flag: 'wx' })
  return path
}
