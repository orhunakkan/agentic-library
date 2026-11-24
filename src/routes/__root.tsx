/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from '@tanstack/react-router'
import { MotionConfig } from 'motion/react'
import { type ReactNode, useEffect } from 'react'
import { AppSidebar } from '~/client/components/AppSidebar'
import { CommandPaletteProvider } from '~/client/components/CommandPalette'
import { shellFor } from '~/client/components/nav-state'
import { SiteFooter } from '~/client/components/SiteFooter'
import { ToastProvider } from '~/client/components/Toast'
import { TopBar } from '~/client/components/TopBar'
import { registerServiceWorker } from '~/client/features/install/service-worker'
import { isNetworkFailure } from '~/client/features/offline/network'
import { reconcileDownloads } from '~/client/features/offline/reconcile'
import { readNav } from '~/client/features/offline/store'
import { PlayerDock } from '~/client/features/player/PlayerDock'
import { PlayerProvider } from '~/client/features/player/PlayerProvider'
import { useReadingTime } from '~/client/features/reading-stats/reading-time'
import { useSync } from '~/client/features/sync/use-sync'
import { BOOT_SCRIPT } from '~/client/lib/boot-script'
import appCss from '~/client/styles/app.css?url'
import { getViewer } from '~/server/account-functions'
import { getNavData } from '~/server/functions'
import { isPrivateBookSlug } from '~/shared/content/book-slug'
import { readerParams } from '~/shared/content/position'
import { SITE_NAME, SITE_TAGLINE } from '~/shared/lib/site'
import { APPLE_TOUCH_ICON, MANIFEST_PATH, THEME_COLOR } from '~/shared/pwa/manifest'

const isPrivateBook = (pathname: string) =>
  isPrivateBookSlug(readerParams(pathname)?.book) || /^\/account\/books\/[0-9a-f-]{36}\/?$/.test(pathname)

type NavData = Awaited<ReturnType<typeof getNavData>>
const EMPTY_NAV: NavData = { stats: { books: 0, series: 0, audiobooks: 0 }, collections: [], featured: [] }

const prerendering = () =>
  import.meta.env.SSR && typeof process !== 'undefined' && process.env.TSS_PRERENDERING === 'true'

const offlineFallback = (error: unknown) => typeof window !== 'undefined' && isNetworkFailure(error)

export const Route = createRootRoute({
  beforeLoad: async () => {
    try {
      return { viewer: await getViewer(), offline: false, shell: prerendering() }
    } catch (error) {
      if (!offlineFallback(error)) throw error
      return { viewer: null, offline: true, shell: false }
    }
  },
  loader: async () => {
    try {
      return await getNavData()
    } catch (error) {
      if (!offlineFallback(error)) throw error
      return (await readNav<NavData>()) ?? EMPTY_NAV
    }
  },
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ matches }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: SITE_NAME },
      { name: 'description', content: SITE_TAGLINE },
      { name: 'theme-color', content: THEME_COLOR },
      { name: 'apple-mobile-web-app-title', content: SITE_NAME },
      ...(matches.some((m) => isPrivateBook(m.pathname))
        ? []
        : [
            { property: 'og:site_name', content: SITE_NAME },
            { property: 'og:locale', content: 'en_US' },
            { name: 'twitter:card', content: 'summary_large_image' },
          ]),
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'manifest', href: MANIFEST_PATH, crossOrigin: 'use-credentials' },
      { rel: 'apple-touch-icon', href: APPLE_TOUCH_ICON.src },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
})

function RootComponent() {
  const nav = Route.useLoaderData()
  const { viewer, offline, shell: fromShell } = Route.useRouteContext()
  const username = viewer?.username ?? null
  useSync(username)
  useReadingTime(username)
  const shell = useRouterState({ select: (s) => shellFor(s.location.pathname) })
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
    void registerServiceWorker({
      nav: navigator,
      prod: import.meta.env.PROD,
      embedded: document.documentElement.dataset.embed === 'on',
    })
  }, [])
  useEffect(() => {
    if (!offline && !fromShell) void reconcileDownloads(username === null ? null : { username })
  }, [username, offline, fromShell])
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <PlayerProvider signedIn={viewer !== null}>
          <CommandPaletteProvider>
            {shell !== 'reader' && (
              <a
                href="#main"
                data-testid="skip-link"
                className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-xl focus:bg-accent-fill focus:px-4 focus:py-2.5 focus:text-[15px] focus:font-semibold focus:text-on-accent"
              >
                Skip to content
              </a>
            )}
            {shell === 'home' ? (
              <Outlet />
            ) : (
              <div className="lg:flex">
                {shell === 'app' && <AppSidebar nav={nav} viewer={viewer} />}
                <div className="min-w-0 flex-1">
                  <TopBar nav={nav} viewer={viewer} alwaysShown={shell === 'reader'} />
                  <Outlet />
                  <SiteFooter />
                </div>
              </div>
            )}
            <PlayerDock />
          </CommandPaletteProvider>
        </PlayerProvider>
      </ToastProvider>
    </MotionConfig>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static pre-paint script built from constants. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
