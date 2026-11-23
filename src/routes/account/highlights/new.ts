import { createFileRoute } from '@tanstack/react-router'
import { handleCreate } from '~/server/highlights/actions'

export const Route = createFileRoute('/account/highlights/new')({
  server: { handlers: { POST: ({ request }) => handleCreate(request) } },
})
