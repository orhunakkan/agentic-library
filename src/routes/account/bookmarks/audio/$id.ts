import { createFileRoute } from '@tanstack/react-router'
import { handleAudioBookmarkChange } from '~/server/bookmarks/audio-actions'

export const Route = createFileRoute('/account/bookmarks/audio/$id')({
  server: { handlers: { POST: ({ request, params }) => handleAudioBookmarkChange(request, params.id) } },
})
