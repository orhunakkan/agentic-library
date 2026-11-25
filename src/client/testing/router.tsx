import {
  type AnyRouter,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { mount } from './mount'

/** What the app's root route puts in its context, as far as the components under test read it. */
export interface TestRouteContext {
  viewer?: { username: string } | null
}

/**
 * Renders `ui` inside a TanStack router on memory history, at `url`, with `context` as the root route's context.
 * Every path matches, so `<Link>`, `useRouter`, `useRouterState` and `useRouteContext({ from: '__root__' })` work
 * as they do in the app. Resolves once the router has loaded and the component is on the page.
 */
export async function mountAt(url: string, ui: ReactNode, context: TestRouteContext = {}): Promise<AnyRouter> {
  const root = createRootRouteWithContext<TestRouteContext>()()
  const anyPath = createRoute({ getParentRoute: () => root, path: '$', component: () => ui })
  const router = createRouter({
    routeTree: root.addChildren([anyPath]),
    history: createMemoryHistory({ initialEntries: [url] }),
    context,
  })
  await router.load()
  mount(<RouterProvider router={router} />)
  return router
}
