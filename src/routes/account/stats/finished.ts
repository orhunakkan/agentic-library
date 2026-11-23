import { createFileRoute } from '@tanstack/react-router'
import { handleFinished } from '~/server/reading-stats/actions'

export const Route = createFileRoute('/account/stats/finished')({
  server: { handlers: { POST: ({ request }) => handleFinished(request) } },
})
