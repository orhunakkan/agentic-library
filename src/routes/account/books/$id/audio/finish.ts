import { createFileRoute } from '@tanstack/react-router'
import { handleAudioFinish } from '~/server/audiobooks/actions'

export const Route = createFileRoute('/account/books/$id/audio/finish')({
  server: { handlers: { POST: ({ request, params }) => handleAudioFinish(request, params.id) } },
})
