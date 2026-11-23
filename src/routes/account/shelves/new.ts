import { createFileRoute } from '@tanstack/react-router'
import { handleShelfCreate } from '~/server/shelves/actions'

export const Route = createFileRoute('/account/shelves/new')({
  server: { handlers: { POST: ({ request }) => handleShelfCreate(request) } },
})
