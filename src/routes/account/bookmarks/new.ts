import { createFileRoute } from '@tanstack/react-router'
import { handleBookmarkCreate } from '~/server/bookmarks/actions'

export const Route = createFileRoute('/account/bookmarks/new')({
  server: { handlers: { POST: ({ request }) => handleBookmarkCreate(request) } },
})
