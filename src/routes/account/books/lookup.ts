import { createFileRoute } from '@tanstack/react-router'
import { handleLookup } from '~/server/book-details/actions'

export const Route = createFileRoute('/account/books/lookup')({
  server: { handlers: { POST: ({ request }) => handleLookup(request) } },
})
