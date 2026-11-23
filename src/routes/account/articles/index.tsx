import { createFileRoute, redirect } from '@tanstack/react-router'
import { type ArticlesNotice, ArticlesPage } from '~/client/features/articles/ArticlesPage'
import { getArticles } from '~/server/account-functions'
import { handleArticlesForm } from '~/server/articles/actions'
import { SITE_NAME } from '~/shared/lib/site'

interface ArticlesSearch {
  url?: string
  status?: 'deleted'
  error?: Exclude<ArticlesNotice, 'deleted'>
}

const ERRORS = ['missing', 'invalid', 'unavailable'] as const

export const Route = createFileRoute('/account/articles/')({
  validateSearch: (search: Record<string, unknown>): ArticlesSearch => ({
    url: typeof search.url === 'string' && search.url.length <= 2000 ? search.url : undefined,
    status: search.status === 'deleted' ? 'deleted' : undefined,
    error: ERRORS.find((e) => e === search.error),
  }),
  beforeLoad: ({ context, location }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: location.href } })
  },
  loader: () => getArticles(),
  gcTime: 0,
  head: () => ({ meta: [{ title: `Articles | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  server: { handlers: { POST: ({ request }) => handleArticlesForm(request) } },
  component: ArticlesScreen,
})

function ArticlesScreen() {
  const { url, status, error } = Route.useSearch()
  return <ArticlesPage state={Route.useLoaderData()} initialUrl={url} notice={status ?? error} />
}
