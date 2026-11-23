import { createFileRoute } from '@tanstack/react-router'
import { handleRepoRaw } from '~/server/github-repos/actions'

export const Route = createFileRoute('/account/repos/$id/raw')({
  server: { handlers: { GET: ({ request, params }) => handleRepoRaw(request, params.id) } },
})
