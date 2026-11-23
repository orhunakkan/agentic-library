import { createFileRoute, redirect } from '@tanstack/react-router'
import { StatsPage } from '~/client/features/reading-stats/StatsPage'
import { getReadingStats } from '~/server/account-functions'
import { SITE_NAME } from '~/shared/lib/site'

export const Route = createFileRoute('/account/stats/')({
  beforeLoad: ({ context }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: '/account/stats' } })
  },
  loader: async () => {
    const data = await getReadingStats()
    if (data.state === 'signed_out') throw redirect({ to: '/login', search: { next: '/account/stats' } })
    return data
  },
  head: () => ({ meta: [{ title: `Reading stats | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: StatsScreen,
})

function StatsScreen() {
  return <StatsPage data={Route.useLoaderData()} />
}
