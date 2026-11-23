import { createFileRoute } from '@tanstack/react-router'
import { handleNewUser } from '~/server/admin/actions'

export const Route = createFileRoute('/account/users/new')({
  server: { handlers: { POST: ({ request }) => handleNewUser(request) } },
})
