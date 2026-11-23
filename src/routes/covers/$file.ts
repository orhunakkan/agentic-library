import { createFileRoute } from '@tanstack/react-router'
import { serveCover } from '~/server/covers'

export const Route = createFileRoute('/covers/$file')({
  server: {
    handlers: {
      GET: ({ params }) => serveCover(params.file),
    },
  },
})
