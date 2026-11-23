import { createFileRoute } from '@tanstack/react-router'
import { handleInviteChange } from '~/server/admin/invites'

export const Route = createFileRoute('/account/users/invites/$id')({
  server: { handlers: { POST: ({ request, params }) => handleInviteChange(request, params.id) } },
})
