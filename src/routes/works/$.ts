import { createFileRoute } from '@tanstack/react-router'
import { libraryPathFor } from '~/server/legacy-paths'

export const Route = createFileRoute('/works/$')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const location = `${libraryPathFor(url.pathname) ?? '/library'}${url.search}`
        return new Response(null, { status: 301, headers: { location } })
      },
    },
  },
})
