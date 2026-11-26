import { createFileRoute, useLoaderData } from '@tanstack/react-router'
import { HERO_LINE } from '~/client/features/home/Hero'
import { HomePage } from '~/client/features/home/HomePage'
import { SITE_NAME } from '~/shared/lib/site'

const TITLE = `${SITE_NAME}: read it, hear it, ask it`

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: HERO_LINE },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: HERO_LINE },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: '/og/library.png' },
    ],
    links: [{ rel: 'canonical', href: '/' }],
  }),
  component: Home,
})

function Home() {
  const { viewer } = Route.useRouteContext()
  const { sourceUrl } = useLoaderData({ from: '__root__' })
  return <HomePage viewer={viewer} sourceUrl={sourceUrl} />
}
