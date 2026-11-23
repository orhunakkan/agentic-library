import { createFileRoute } from '@tanstack/react-router'
import { handleAddOptions } from '~/server/passkeys/actions'

export const Route = createFileRoute('/account/passkeys/options')({
  server: { handlers: { POST: ({ request }) => handleAddOptions(request) } },
})
