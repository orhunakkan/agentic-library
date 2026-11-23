import { createFileRoute } from '@tanstack/react-router'
import { handleSignInChallenge } from '~/server/passkeys/sign-in'

export const Route = createFileRoute('/passkeys/challenge')({
  server: { handlers: { POST: ({ request }) => handleSignInChallenge(request) } },
})
