import { createFileRoute, redirect } from '@tanstack/react-router'
import { PromptsPage } from '~/client/features/ask-prompts/PromptsPage'
import { getAskPrompts } from '~/server/account-functions'
import { SITE_NAME } from '~/shared/lib/site'

export const Route = createFileRoute('/account/prompts/')({
  beforeLoad: ({ context }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: '/account/prompts' } })
  },
  loader: () => getAskPrompts(),
  gcTime: 0,
  head: () => ({ meta: [{ title: `Your prompts | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: PromptsScreen,
})

function PromptsScreen() {
  return <PromptsPage state={Route.useLoaderData()} />
}
