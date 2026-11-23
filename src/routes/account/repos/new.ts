import { createFileRoute } from '@tanstack/react-router'
import { handleRepoAdd } from '~/server/github-repos/actions'

export const Route = createFileRoute('/account/repos/new')({
  server: { handlers: { POST: ({ request }) => handleRepoAdd(request) } },
})
