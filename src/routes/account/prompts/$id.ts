import { createFileRoute } from '@tanstack/react-router'
import { handlePromptChange } from '~/server/ask-prompts/actions'

export const Route = createFileRoute('/account/prompts/$id')({
  server: { handlers: { POST: ({ request, params }) => handlePromptChange(request, params.id) } },
})
