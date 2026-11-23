import { createFileRoute } from '@tanstack/react-router'
import { handleOfflineBook } from '~/server/downloads/handler'

export const Route = createFileRoute('/offline/$file')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleOfflineBook(request, params.file),
    },
  },
})
