import { RUN_CODE_PREFIX } from '../shared/run-code/engines.ts'

const NO_CACHE = new Set(['/sw.js', '/offline.html', '/_shell.html', '/app-files.json'])

export function cacheControlFor(pathname: string): string | null {
  return NO_CACHE.has(pathname) ? 'no-cache' : null
}

export function headersFor(pathname: string): Record<string, string> | null {
  if (!pathname.startsWith(RUN_CODE_PREFIX)) return null
  const headers: Record<string, string> = {
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  }
  if (pathname.endsWith('.wasm')) headers['content-type'] = 'application/wasm'
  else if (pathname.endsWith('.mjs')) headers['content-type'] = 'text/javascript; charset=utf-8'
  return headers
}
