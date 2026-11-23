import { createFileRoute } from '@tanstack/react-router'
import { handleGoal } from '~/server/reading-stats/actions'

export const Route = createFileRoute('/account/stats/goal')({
  server: { handlers: { POST: ({ request }) => handleGoal(request) } },
})
