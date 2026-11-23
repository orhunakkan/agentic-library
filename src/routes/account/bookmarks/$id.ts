import { createFileRoute } from '@tanstack/react-router'
import { handleBookmarkChange } from '~/server/bookmarks/actions'

export const Route = createFileRoute('/account/bookmarks/$id')({
  server: { handlers: { POST: ({ request, params }) => handleBookmarkChange(request, params.id) } },
})
