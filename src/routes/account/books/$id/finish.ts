import { createFileRoute } from '@tanstack/react-router'
import { handleFinish } from '~/server/book-actions'

export const Route = createFileRoute('/account/books/$id/finish')({
  server: { handlers: { POST: ({ request, params }) => handleFinish(request, params.id) } },
})
