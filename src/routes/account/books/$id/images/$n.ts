import { createFileRoute } from '@tanstack/react-router'
import { handleImage, serveImage } from '~/server/book-images/actions'

export const Route = createFileRoute('/account/books/$id/images/$n')({
  server: {
    handlers: {
      GET: ({ request, params }) => serveImage(request, params.id, params.n),
      POST: ({ request, params }) => handleImage(request, params.id, params.n),
    },
  },
})
