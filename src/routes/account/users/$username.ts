import { createFileRoute } from '@tanstack/react-router'
import { handleUserChange } from '~/server/admin/actions'

export const Route = createFileRoute('/account/users/$username')({
  server: { handlers: { POST: ({ request, params }) => handleUserChange(request, params.username) } },
})
