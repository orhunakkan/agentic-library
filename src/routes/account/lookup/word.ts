import { createFileRoute } from '@tanstack/react-router'
import { handleWordLookup } from '~/server/lookup/actions'

export const Route = createFileRoute('/account/lookup/word')({
  server: { handlers: { POST: ({ request }) => handleWordLookup(request) } },
})
