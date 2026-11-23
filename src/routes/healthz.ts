import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '~/server/db'
import { logError } from '~/server/redact'

export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: async () => {
        const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
        try {
          await getDb()`select 1`
          return new Response('ok', { headers })
        } catch (error) {
          logError('healthz', error)
          return new Response('unavailable', { status: 503, headers })
        }
      },
    },
  },
})
