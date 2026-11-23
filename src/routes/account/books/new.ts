import { createFileRoute } from '@tanstack/react-router'
import { handleNewBook } from '~/server/book-actions'

export const Route = createFileRoute('/account/books/new')({
  server: { handlers: { POST: ({ request }) => handleNewBook(request) } },
})
