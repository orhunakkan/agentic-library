import { createFileRoute } from '@tanstack/react-router'
import { handleArticlePicture } from '~/server/articles/actions'

export const Route = createFileRoute('/account/articles/picture')({
  server: { handlers: { POST: ({ request }) => handleArticlePicture(request) } },
})
