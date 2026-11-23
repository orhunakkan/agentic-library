import { createFileRoute } from '@tanstack/react-router'
import { handleShelfChange } from '~/server/shelves/actions'

export const Route = createFileRoute('/account/shelves/$id/')({
  server: { handlers: { POST: ({ request, params }) => handleShelfChange(request, params.id) } },
})
