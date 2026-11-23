import { createFileRoute } from '@tanstack/react-router'
import { handleExport } from '~/server/highlights/export'

export const Route = createFileRoute('/account/highlights/export/$book')({
  server: { handlers: { GET: ({ request, params }) => handleExport(request, params.book) } },
})
