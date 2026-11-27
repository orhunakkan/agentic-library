import { fileURLToPath } from 'node:url'
import { type ServerMiddleware, serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import { ConfigError, parseConfig } from '../src/server/config.ts'
import { cacheControlFor, headersFor } from '../src/server/static-cache.ts'
import { VOICES_PREFIX, voiceResponse } from '../src/server/voices-static.ts'

const root = fileURLToPath(new URL('../', import.meta.url))

const staticCacheHeaders: ServerMiddleware = async (request, next) => {
  const response = await next()
  const pathname = new URL(request.url).pathname
  const cache = cacheControlFor(pathname)
  const headers: Record<string, string> = {
    ...(cache ? { 'cache-control': cache } : {}),
    ...(response.ok ? (headersFor(pathname) ?? {}) : {}),
  }
  if (!Object.keys(headers).length) return response
  const set = (target: Headers) => {
    for (const [name, value] of Object.entries(headers)) target.set(name, value)
  }
  try {
    set(response.headers)
    return response
  } catch {
    const copy = new Response(response.body, response)
    set(copy.headers)
    return copy
  }
}

const voices =
  (dir: string): ServerMiddleware =>
  (request, next) =>
    new URL(request.url).pathname.startsWith(VOICES_PREFIX) ? voiceResponse(request, dir) : next()

async function startServer() {
  let voicesDir: string
  try {
    voicesDir = parseConfig(process.env).voicesDir
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(`agentic-library: ${error.message}`)
    process.exit(1)
  }
  const entry = (await import(new URL('../dist/server/server.js', import.meta.url).href)) as {
    default: { fetch: (request: Request) => Response | Promise<Response> }
  }
  return serve({
    port: Number(process.env.PORT ?? 3000),
    hostname: process.env.HOST ?? '127.0.0.1',
    middleware: [staticCacheHeaders, voices(voicesDir), staticMiddleware({ dir: `${root}dist/client` })],
    fetch: (request) => entry.default.fetch(request),
  })
}

if (import.meta.main) await startServer()
