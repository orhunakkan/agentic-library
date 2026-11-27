import { createFileRoute, redirect } from '@tanstack/react-router'
import { ReposPage } from '~/client/features/github-repos/ReposPage'
import { isNetworkFailure } from '~/client/features/offline/network'
import { reposFromCopies } from '~/client/features/offline/repo-reader'
import { getRepos } from '~/server/account-functions'
import { SITE_NAME } from '~/shared/lib/site'

export const Route = createFileRoute('/account/repos/')({
  beforeLoad: ({ context }) => {
    if (!context.viewer && !context.offline) throw redirect({ to: '/login', search: { next: '/account/repos' } })
  },
  loader: async () => {
    try {
      return { ...(await getRepos()), offline: false }
    } catch (error) {
      if (typeof window === 'undefined' || !isNetworkFailure(error)) throw error
      return reposFromCopies()
    }
  },
  gcTime: 0,
  head: () => ({ meta: [{ title: `Repositories | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: ReposScreen,
})

function ReposScreen() {
  const { offline, ...state } = Route.useLoaderData()
  return <ReposPage state={state} offline={offline} />
}
