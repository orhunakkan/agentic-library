import { createFileRoute } from '@tanstack/react-router'
import { handlePlanState } from '~/server/billing/actions'

export const Route = createFileRoute('/account/plan/state')({
  server: { handlers: { GET: ({ request }) => handlePlanState(request) } },
})
