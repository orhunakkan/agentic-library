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
import { hookElement, type Mounted, type MountedHook, mount } from './mount'

/** What the app's root route puts in its context, as far as the components under test read it. */
export interface TestRouteContext {
  viewer?: { username: string } | null
  /** True when the root route found no network, as `__root.tsx` sets it. */
  offline?: boolean
  /**
   * True when the page started from the prerendered app shell, which the service worker serves offline: its root
   * context is the prerender's, so it says neither offline nor signed in.
   */
  shell?: boolean
}

/**
 * Renders `ui` inside a TanStack router on memory history, at `url`, with `context` as the root route's context.
 * Every path matches, so `<Link>`, `useRouter`, `useRouterState` and `useRouteContext({ from: '__root__' })` work
 * as they do in the app. Resolves once the router has loaded and the component is on the page.
 */
export async function mountAt(url: string, ui: ReactNode, context: TestRouteContext = {}): Promise<AnyRouter> {
  return (await mountRouterAt(url, ui, context)).router
}

async function mountRouterAt(
  url: string,
  ui: ReactNode,
  context: TestRouteContext,
): Promise<{ router: AnyRouter; mounted: Mounted }> {
  const root = createRootRouteWithContext<TestRouteContext>()()
  const anyPath = createRoute({ getParentRoute: () => root, path: '$', component: () => ui })
  return mountRouter(root.addChildren([anyPath]), url, context)
}

/** Loads a router for `routeTree` on memory history at `url`, then puts it on the page. */
async function mountRouter(
  routeTree: AnyRoute,
  url: string,
  context: TestRouteContext,
): Promise<{ router: AnyRouter; mounted: Mounted }> {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [url] }), context })
  await router.load()
  return { router, mounted: mount(<RouterProvider router={router} />) }
}

/**
 * Renders a React hook inside the same router as `mountAt`, for hooks that read it (`useRouter`, `useRouteContext`),
 * and returns its latest result. `wrap` puts providers around it, such as `ToastProvider`.
 */
export async function mountHookAt<P, R>(
  url: string,
  useHook: (props: P) => R,
  props: NoInfer<P>,
  {
    context = {},
    wrap = (children) => children,
  }: { context?: TestRouteContext; wrap?: (children: ReactNode) => ReactNode } = {},
): Promise<MountedHook<P, R> & { router: AnyRouter }> {
  const { element, handle } = hookElement(useHook, props)
  const { router, mounted } = await mountRouterAt(url, wrap(element), context)
  return Object.assign(handle(mounted), { router })
}

/** What the app's root loader returns, as far as the pages under test read it. */
export interface TestNavData {
  sourceUrl: string | null
}

/**
 * Renders one of the app's own file routes at `path`, under a stand-in root whose loader returns `nav`, the way the
 * generated route tree attaches it. The route's own loader runs, so mock the server functions it calls. A route with
 * a parameter gives its pattern as `path` and the address to open as `url`; `context` is the root route's context.
 */
export async function mountRoute(
  route: AnyRoute,
  path: string,
  nav: TestNavData,
  { url = path, context = {} }: { url?: string; context?: TestRouteContext } = {},
): Promise<AnyRouter> {
  const root = createRootRouteWithContext<TestRouteContext>()({ loader: () => nav })
  /** The generated tree attaches each file route this way; its types only fit inside that tree. */
  const attached = route.update({ id: path, path, getParentRoute: () => root } as never)
  return (await mountRouter(root.addChildren([attached]), url, context)).router
}
