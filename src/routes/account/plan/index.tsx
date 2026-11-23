import { createFileRoute, redirect } from '@tanstack/react-router'
import { AccountPage } from '~/client/features/account/ui'
import { ProPage } from '~/client/features/billing/ProPage'
import { getPlanPage } from '~/server/account-functions'
import { PRO_PAGE_TITLE } from '~/shared/billing/copy'
import { SITE_NAME } from '~/shared/lib/site'

export const Route = createFileRoute('/account/plan/')({
  beforeLoad: ({ context }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: '/account/plan' } })
  },
  loader: () => getPlanPage(),
  head: () => ({ meta: [{ title: `Pro | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  component: PlanScreen,
})

function PlanScreen() {
  const state = Route.useLoaderData()
  return (
    <AccountPage eyebrow="Account" title={PRO_PAGE_TITLE} titleTestId="pro-title" nav>
      <ProPage initial={state} />
    </AccountPage>
  )
}
