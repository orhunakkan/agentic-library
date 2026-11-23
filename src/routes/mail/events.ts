import { createFileRoute } from '@tanstack/react-router'
import { handleMailEvent } from '~/server/mail/webhook'

export const Route = createFileRoute('/mail/events')({
  server: { handlers: { POST: ({ request }) => handleMailEvent(request) } },
})
