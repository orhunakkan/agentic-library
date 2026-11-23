const KEY = /sk-ant-[A-Za-z0-9_-]+/g
const HEADER = /(xi?-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi
const BEARER = /(authorization["']?\s*[:=]\s*["']?bearer\s+)[^\s"',}]+/gi
const TOKEN = /(\btoken=)[^&\s"'#]+/gi
const PADDLE = /\bpdl_[a-z]+_[A-Za-z0-9_]+/g
const ACCESS_TOKEN = /folio_at_[A-Za-z0-9_-]+/g
const GITHUB_TOKEN = /\b(github_pat|ghp)_[A-Za-z0-9_]+/g

export function redact(text: string): string {
  return text
    .replace(KEY, 'sk-ant-[redacted]')
    .replace(HEADER, '$1[redacted]')
    .replace(BEARER, '$1[redacted]')
    .replace(TOKEN, '$1[redacted]')
    .replace(PADDLE, 'pdl_[redacted]')
    .replace(ACCESS_TOKEN, 'folio_at_[redacted]')
    .replace(GITHUB_TOKEN, '$1_[redacted]')
}

export function describeError(error: unknown, depth = 0): string {
  if (depth > 4) return '…'
  if (error instanceof Error) {
    const head = error.stack ?? `${error.name}: ${error.message}`
    const cause = error.cause === undefined ? '' : `\ncaused by: ${describeError(error.cause, depth + 1)}`
    return redact(`${head}${cause}`)
  }
  try {
    return redact(typeof error === 'string' ? error : JSON.stringify(error))
  } catch {
    return '[unprintable error]'
  }
}

export function logError(context: string, error: unknown): void {
  console.error(`[${redact(context)}] ${describeError(error)}`)
}
