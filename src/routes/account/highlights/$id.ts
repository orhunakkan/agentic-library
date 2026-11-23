import { createFileRoute } from '@tanstack/react-router'
import { handleChange } from '~/server/highlights/actions'

export const Route = createFileRoute('/account/highlights/$id')({
  server: { handlers: { POST: ({ request, params }) => handleChange(request, params.id) } },
})
