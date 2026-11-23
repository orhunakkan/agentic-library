import { createFileRoute } from '@tanstack/react-router'
import { handleAudioBookmarkCreate } from '~/server/bookmarks/audio-actions'

export const Route = createFileRoute('/account/bookmarks/audio/new')({
  server: { handlers: { POST: ({ request }) => handleAudioBookmarkCreate(request) } },
})
