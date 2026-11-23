import { createFileRoute } from '@tanstack/react-router'
import { handleCoverGet, handleCoverUpload } from '~/server/book-details/actions'

export const Route = createFileRoute('/account/books/$id/cover')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleCoverGet(request, params.id),
      POST: ({ request, params }) => handleCoverUpload(request, params.id),
    },
  },
})
