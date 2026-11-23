import { createFileRoute } from '@tanstack/react-router'
import { handleSignIn } from '~/server/passkeys/sign-in'

export const Route = createFileRoute('/passkeys/sign-in')({
  server: { handlers: { POST: ({ request }) => handleSignIn(request) } },
})
