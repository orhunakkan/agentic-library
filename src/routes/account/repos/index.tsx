import { createFileRoute, redirect } from '@tanstack/react-router'
import { ReposPage } from '~/client/features/github-repos/ReposPage'
import { getRepos } from '~/server/account-functions'
import { SITE_NAME } from '~/shared/lib/site'

export const Route = createFileRoute('/account/repos/')({
  beforeLoad: ({ context }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: '/account/repos' } })
  },
  loader: () => getRepos(),
  gcTime: 0,
  head: () => ({ meta: [{ title: `Repositories | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: ReposScreen,
})

function ReposScreen() {
  return <ReposPage state={Route.useLoaderData()} />
}
