import { createFileRoute } from '@tanstack/react-router'
import { handleSpeak } from '~/server/speech/actions'

export const Route = createFileRoute('/account/read-aloud/speak')({
  server: { handlers: { POST: ({ request }) => handleSpeak(request) } },
})
