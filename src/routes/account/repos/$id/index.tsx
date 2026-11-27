import { createFileRoute, ErrorComponent, type ErrorComponentProps, notFound, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { NotFound } from '~/client/components/NotFound'
import { RepoOffline, RepoUnavailable, RepoViewer } from '~/client/features/github-repos/RepoViewer'
import { isNetworkFailure } from '~/client/features/offline/network'
import { forgetGoneRepoCopy } from '~/client/features/offline/reconcile'
import { isRepoOfflineMissing, repoViewFromCopy } from '~/client/features/offline/repo-reader'
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
    /**
     * Offline there's no viewer to check: the root says so, or the page started from the prerendered app shell, whose
     * context is the prerender's. The loader then opens this device's copy, if it has one.
     */
    if (!context.viewer && !context.offline && !context.shell) {
      const query = new URLSearchParams()
      if (search.path) query.set('path', search.path)
      if (search.view) query.set('view', search.view)
      const next = `/account/repos/${params.id}${query.size ? `?${query}` : ''}`
      throw redirect({ to: '/login', search: { next } })
    }
  },
  loaderDeps: ({ search }) => ({ path: search.path ?? '', view: search.view ?? 'preview' }),
  loader: async ({ params, deps }) => {
    try {
      const state = await getRepoView({ data: { id: params.id, path: deps.path, view: deps.view } })
      if (state.state === 'not_found') throw notFound()
      return { ...state, offline: false, pictures: [] }
    } catch (error) {
      if (typeof window === 'undefined' || !isNetworkFailure(error)) throw error
      return repoViewFromCopy(params.id, deps.path)
    }
  },
  head: ({ loaderData }) => {
    const pageName = loaderData?.state === 'ready' ? `${loaderData.repo.owner}/${loaderData.repo.name}` : 'Repository'
    return { meta: [{ title: `${pageName} | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }
  },
  headers: () => ({ 'cache-control': 'private, no-store' }),
  server: { handlers: { POST: ({ request, params }) => handleRepoAction(request, params.id) } },
  component: RepoScreen,
  errorComponent: RepoError,
  notFoundComponent: RepoNotFound,
})

function RepoScreen() {
  const state = Route.useLoaderData()
  const { path = '' } = Route.useSearch()
  if (state.state !== 'ready') return <RepoUnavailable state={state} />
  const offline = state.offline ? { pictures: state.pictures } : null
  return <RepoViewer key={state.repo.id} data={state} path={path} offline={offline} />
}

function RepoError(props: ErrorComponentProps) {
  if (!isRepoOfflineMissing(props.error)) return <ErrorComponent {...props} />
  return <RepoOffline />
}

/** The server says this account has no such repository, so a copy of it on this device goes too. */
function RepoNotFound() {
  const { id } = Route.useParams()
  useEffect(() => {
    void forgetGoneRepoCopy(id)
  }, [id])
  return <NotFound />
}
