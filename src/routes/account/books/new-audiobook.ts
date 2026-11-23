import { createFileRoute } from '@tanstack/react-router'
import { handleNewAudiobook } from '~/server/audiobooks/actions'

export const Route = createFileRoute('/account/books/new-audiobook')({
  server: { handlers: { POST: ({ request }) => handleNewAudiobook(request) } },
})
