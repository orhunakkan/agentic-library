import { createFileRoute } from '@tanstack/react-router'
import { handleCardSave } from '~/server/flashcards/actions'

export const Route = createFileRoute('/account/flashcards/new')({
  server: { handlers: { POST: ({ request }) => handleCardSave(request) } },
})
