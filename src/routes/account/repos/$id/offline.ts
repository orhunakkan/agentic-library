import { createFileRoute } from '@tanstack/react-router'
import { handleRepoOfflineBatch, handleRepoOfflinePlan } from '~/server/github-repos/offline'

export const Route = createFileRoute('/account/repos/$id/offline')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleRepoOfflinePlan(request, params.id),
      POST: ({ request, params }) => handleRepoOfflineBatch(request, params.id),
    },
  },
})
