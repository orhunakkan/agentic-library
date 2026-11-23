import { createFileRoute } from '@tanstack/react-router'
import { handleTokenRevoke } from '~/server/access-tokens/actions'

export const Route = createFileRoute('/api/tokens/$id')({
  server: { handlers: { POST: ({ request, params }) => handleTokenRevoke(request, params.id) } },
})
