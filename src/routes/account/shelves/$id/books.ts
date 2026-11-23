import { createFileRoute } from '@tanstack/react-router'
import { handleShelfBook } from '~/server/shelves/actions'

export const Route = createFileRoute('/account/shelves/$id/books')({
  server: { handlers: { POST: ({ request, params }) => handleShelfBook(request, params.id) } },
})
