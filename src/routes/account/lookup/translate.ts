import { createFileRoute } from '@tanstack/react-router'
import { handleTranslate } from '~/server/lookup/actions'

export const Route = createFileRoute('/account/lookup/translate')({
  server: { handlers: { POST: ({ request }) => handleTranslate(request) } },
})
