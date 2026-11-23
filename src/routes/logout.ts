import { createFileRoute } from '@tanstack/react-router'
import { handleLogout } from '~/server/account-actions'

export const Route = createFileRoute('/logout')({
  server: { handlers: { POST: ({ request }) => handleLogout(request) } },
})
