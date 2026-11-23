import { createFileRoute } from '@tanstack/react-router'
import { serveContentImage } from '~/server/content-images'

export const Route = createFileRoute('/images/$slug/$file')({
  server: {
    handlers: {
      GET: ({ params }) => serveContentImage(params.slug, params.file),
    },
  },
})
