import { createFileRoute } from '@tanstack/react-router'
import { handleArticleFetch } from '~/server/articles/actions'

export const Route = createFileRoute('/account/articles/fetch')({
  server: { handlers: { POST: ({ request }) => handleArticleFetch(request) } },
})
