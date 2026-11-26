import {
  type AnyRoute,
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

/** What the app's root loader returns, as far as the pages under test read it. */
export interface TestNavData {
  sourceUrl: string | null
}

/**
 * Renders one of the app's own file routes at `path`, under a stand-in root whose loader returns `nav`, the way the
 * generated route tree attaches it. The route's own loader runs, so mock the server functions it calls.
 */
export async function mountRoute(route: AnyRoute, path: string, nav: TestNavData): Promise<AnyRouter> {
  const root = createRootRouteWithContext<TestRouteContext>()({ loader: () => nav })
  /** The generated tree attaches each file route this way; its types only fit inside that tree. */
  const attached = route.update({ id: path, path, getParentRoute: () => root } as never)
  const router = createRouter({
    routeTree: root.addChildren([attached]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: {},
  })
  await router.load()
  mount(<RouterProvider router={router} />)
  return router
}
