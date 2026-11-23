import { createFileRoute } from '@tanstack/react-router'
import { handleApply } from '~/server/book-details/actions'

export const Route = createFileRoute('/account/books/$id/open-library')({
  server: { handlers: { POST: ({ request, params }) => handleApply(request, params.id) } },
})
