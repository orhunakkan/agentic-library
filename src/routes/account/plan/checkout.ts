import { createFileRoute } from '@tanstack/react-router'
import { handleCheckout } from '~/server/billing/actions'

export const Route = createFileRoute('/account/plan/checkout')({
  server: { handlers: { POST: ({ request }) => handleCheckout(request) } },
})
