import { createFileRoute } from '@tanstack/react-router'
import { handleNewInvite } from '~/server/admin/invites'

export const Route = createFileRoute('/account/users/invites/new')({
  server: { handlers: { POST: ({ request }) => handleNewInvite(request) } },
})
