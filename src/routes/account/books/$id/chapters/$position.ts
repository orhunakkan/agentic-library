import { createFileRoute } from '@tanstack/react-router'
import { handleChapter } from '~/server/book-actions'

export const Route = createFileRoute('/account/books/$id/chapters/$position')({
  server: { handlers: { POST: ({ request, params }) => handleChapter(request, params.id, params.position) } },
})
