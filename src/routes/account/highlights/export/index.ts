import { createFileRoute } from '@tanstack/react-router'
import { handleExportAll } from '~/server/highlights/export'

export const Route = createFileRoute('/account/highlights/export/')({
  server: { handlers: { GET: ({ request }) => handleExportAll(request) } },
})
