import { createFileRoute } from '@tanstack/react-router'
import { handleTokenCreate, handleTokenList } from '~/server/access-tokens/actions'

export const Route = createFileRoute('/api/tokens/')({
  server: {
    handlers: {
      GET: ({ request }) => handleTokenList(request),
      POST: ({ request }) => handleTokenCreate(request),
    },
  },
})
