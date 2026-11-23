import { createFileRoute } from '@tanstack/react-router'
import { handleAudioChunk } from '~/server/audiobooks/actions'
import { serveAudio } from '~/server/audiobooks/serve'

export const Route = createFileRoute('/account/books/$id/audio/$n')({
  server: {
    handlers: {
      GET: ({ request, params }) => serveAudio(request, params.id, params.n),
      HEAD: ({ request, params }) => serveAudio(request, params.id, params.n),
      POST: ({ request, params }) => handleAudioChunk(request, params.id, params.n),
    },
  },
})
