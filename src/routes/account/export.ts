import { createFileRoute } from '@tanstack/react-router'
import { handleAccountExport } from '~/server/account-data/handler'

export const Route = createFileRoute('/account/export')({
  server: { handlers: { GET: ({ request }) => handleAccountExport(request) } },
})
