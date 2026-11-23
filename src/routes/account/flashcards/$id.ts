import { createFileRoute } from '@tanstack/react-router'
import { handleCardChange } from '~/server/flashcards/actions'

export const Route = createFileRoute('/account/flashcards/$id')({
  server: { handlers: { POST: ({ request, params }) => handleCardChange(request, params.id) } },
})
