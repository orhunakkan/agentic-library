import { createFileRoute } from '@tanstack/react-router'
import { handlePaddleEvent } from '~/server/billing/webhook'

export const Route = createFileRoute('/billing/paddle')({
  server: { handlers: { POST: ({ request }) => handlePaddleEvent(request) } },
})
