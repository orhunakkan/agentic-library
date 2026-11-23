import { createFileRoute } from '@tanstack/react-router'
import { handleRemovedBook } from '~/server/removed-books/actions'

export const Route = createFileRoute('/account/removed-books')({
  server: { handlers: { POST: ({ request }) => handleRemovedBook(request) } },
})
