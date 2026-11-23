import { createFileRoute } from '@tanstack/react-router'
import { handleSync } from '~/server/sync/actions'

export const Route = createFileRoute('/account/sync')({
  server: { handlers: { POST: ({ request }) => handleSync(request) } },
})
