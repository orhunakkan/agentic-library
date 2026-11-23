export const DEFAULT_AFTER_SIGN_IN = '/library'

export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 1000) return DEFAULT_AFTER_SIGN_IN
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_AFTER_SIGN_IN
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is being rejected.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return DEFAULT_AFTER_SIGN_IN
  try {
    const base = 'http://same.invalid'
    const url = new URL(next, base)
    const path = `${url.pathname}${url.search}${url.hash}`
    if (url.origin !== base || path.startsWith('//') || path.startsWith('/\\')) return DEFAULT_AFTER_SIGN_IN
    return path
  } catch {
    return DEFAULT_AFTER_SIGN_IN
  }
}
