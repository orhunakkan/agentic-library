import { isReservedSignupName, USERNAME_PATTERN } from '../../shared/signup/signup.ts'
import { isObject, only } from '../ask/input.ts'
import { parseEmail } from '../email/input.ts'
import { normalizeUsername } from '../users.ts'

export const MAX_FIELD = 1024

const field = (form: FormData, name: string) => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

export function parseSignupRequest(form: FormData): { email: string | null; honeypot: boolean } {
  const raw = field(form, 'email')
  return {
    email: raw.length > MAX_FIELD ? null : parseEmail(raw),
    honeypot: field(form, 'website').trim() !== '',
  }
}

export interface SignupFinish {
  token: string
  username: string
  password: string
  confirm: string
}

export function parseSignupFinish(form: FormData): SignupFinish | null {
  const values = {
    token: field(form, 'token'),
    username: field(form, 'username'),
    password: field(form, 'password'),
    confirm: field(form, 'confirm'),
  }
  if (Object.values(values).some((v) => v.length > MAX_FIELD)) return null
  return { ...values, username: normalizeUsername(values.username) }
}

export function usernameProblem(username: string): 'username' | 'taken' | null {
  if (!USERNAME_PATTERN.test(username)) return 'username'
  return isReservedSignupName(username) ? 'taken' : null
}

const MAX_NOTE = 60

export function parseInviteNote(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return 'invalid'
  const text = [...value]
    .filter((c) => {
      const code = c.codePointAt(0) ?? 0
      return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code < 0xa0)
    })
    .join('')
    .trim()
  if (!text) return null
  return [...text].length > MAX_NOTE ? 'invalid' : text
}

export function parseNewInvite(value: unknown): { note: string | null } | null {
  if (!isObject(value) || !only(value, ['note'])) return null
  const note = parseInviteNote(value.note)
  return note === 'invalid' ? null : { note }
}

export function parseInviteChange(value: unknown): { intent: 'revoke' } | null {
  return isObject(value) && only(value, ['intent']) && value.intent === 'revoke' ? { intent: 'revoke' } : null
}
