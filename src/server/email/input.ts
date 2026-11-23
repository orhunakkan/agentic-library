const MAX_ADDRESS = 254
const MAX_LOCAL = 64
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const USERNAME = /^[a-z0-9][a-z0-9_-]{2,31}$/

export function parseEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (text.length < 3 || text.length > MAX_ADDRESS) return null
  if (!/^[\x21-\x7e]+$/.test(text)) return null
  const parts = text.split('@')
  if (parts.length !== 2) return null
  const [local = '', rawDomain = ''] = parts
  if (local.length < 1 || local.length > MAX_LOCAL) return null
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null
  const domain = rawDomain.toLowerCase()
  const labels = domain.split('.')
  if (labels.length < 2 || !labels.every((label) => label.length <= 63 && LABEL.test(label))) return null
  return `${local}@${domain}`
}

export const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export type ResetIdentifier = { by: 'username'; username: string } | { by: 'email'; email: string }

export function parseResetIdentifier(input: unknown): ResetIdentifier | null {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (text.length === 0 || text.length > MAX_ADDRESS) return null
  if (text.includes('@')) {
    const email = parseEmail(text)
    return email ? { by: 'email', email } : null
  }
  const username = text.toLowerCase()
  return USERNAME.test(username) ? { by: 'username', username } : null
}
