import { createFileRoute } from '@tanstack/react-router'
import { handlePortal } from '~/server/billing/actions'

export const Route = createFileRoute('/account/plan/portal')({
  server: { handlers: { POST: ({ request }) => handlePortal(request) } },
})
