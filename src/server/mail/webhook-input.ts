import { isObject } from '../../shared/lib/json-shape.ts'
import { parseEmail } from '../email/input.ts'

export type MailEventKind = 'bounce' | 'complaint' | 'suppressed'

export interface MailEvent {
  kind: MailEventKind
  to: string[]
}

function kindOf(type: unknown, data: Record<string, unknown>): MailEventKind | null {
  if (type === 'email.complained') return 'complaint'
  if (type === 'email.suppressed') return 'suppressed'
  if (type === 'email.bounced' && isObject(data.bounce) && data.bounce.type === 'Permanent') return 'bounce'
  return null
}

function addresses(to: unknown): string[] {
  if (!Array.isArray(to)) return []
  const found = to
    .slice(0, 50)
    .map((entry) => (typeof entry === 'string' ? parseEmail(/<([^<>]+)>\s*$/.exec(entry)?.[1] ?? entry) : null))
    .filter((email): email is string => email !== null)
  return [...new Set(found.map((email) => email.toLowerCase()))]
}

export function parseMailEvent(value: unknown): MailEvent | null {
  if (!isObject(value) || !isObject(value.data)) return null
  const kind = kindOf(value.type, value.data)
  if (!kind) return null
  const to = addresses(value.data.to)
  return to.length > 0 ? { kind, to } : null
}
