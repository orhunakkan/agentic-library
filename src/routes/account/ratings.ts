import { createFileRoute } from '@tanstack/react-router'
import { handleRating } from '~/server/ratings/actions'

export const Route = createFileRoute('/account/ratings')({
  server: { handlers: { POST: ({ request }) => handleRating(request) } },
})
