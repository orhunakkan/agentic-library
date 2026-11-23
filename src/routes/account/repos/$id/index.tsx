import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { RepoUnavailable, RepoViewer } from '~/client/features/github-repos/RepoViewer'
import { getRepoView } from '~/server/account-functions'
import { handleRepoAction } from '~/server/github-repos/actions'
import { SITE_NAME } from '~/shared/lib/site'

interface RepoSearch {
  path?: string
  view?: 'code'
}

export const Route = createFileRoute('/account/repos/$id/')({
  validateSearch: (search: Record<string, unknown>): RepoSearch => ({
    path: typeof search.path === 'string' && search.path ? search.path : undefined,
    view: search.view === 'code' ? 'code' : undefined,
  }),
  beforeLoad: ({ context, params, search }) => {
    if (!context.viewer) {
      const query = new URLSearchParams()
      if (search.path) query.set('path', search.path)
      if (search.view) query.set('view', search.view)
      const next = `/account/repos/${params.id}${query.size ? `?${query}` : ''}`
      throw redirect({ to: '/login', search: { next } })
    }
  },
  loaderDeps: ({ search }) => ({ path: search.path ?? '', view: search.view ?? 'preview' }),
  loader: async ({ params, deps }) => {
    const state = await getRepoView({ data: { id: params.id, path: deps.path, view: deps.view } })
    if (state.state === 'not_found') throw notFound()
    return state
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.state === 'ready' ? `${loaderData.repo.owner}/${loaderData.repo.name}` : 'Repository'} | ${SITE_NAME}`,
      },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  server: { handlers: { POST: ({ request, params }) => handleRepoAction(request, params.id) } },
  component: RepoScreen,
})

function RepoScreen() {
  const state = Route.useLoaderData()
  const { path = '' } = Route.useSearch()
  if (state.state !== 'ready') return <RepoUnavailable state={state} />
  return <RepoViewer key={state.repo.id} data={state} path={path} />
}
