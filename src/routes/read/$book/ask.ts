import { createFileRoute } from '@tanstack/react-router'
import { handleAsk } from '~/server/ask/ask'

export const Route = createFileRoute('/read/$book/ask')({
  server: { handlers: { POST: ({ request, params }) => handleAsk(request, params.book) } },
})
