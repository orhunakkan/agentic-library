import { createFileRoute } from '@tanstack/react-router'
import { handlePromptNew } from '~/server/ask-prompts/actions'

export const Route = createFileRoute('/account/prompts/new')({
  server: { handlers: { POST: ({ request }) => handlePromptNew(request) } },
})
