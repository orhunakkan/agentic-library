import { createFileRoute } from '@tanstack/react-router'
import { handleNewPasskey } from '~/server/passkeys/actions'

export const Route = createFileRoute('/account/passkeys/new')({
  server: { handlers: { POST: ({ request }) => handleNewPasskey(request) } },
})
