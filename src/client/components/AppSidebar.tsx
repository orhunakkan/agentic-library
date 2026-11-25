import { useRouterState } from '@tanstack/react-router'
import {
  ChartNoAxesColumn,
  FolderGit2,
  Headphones,
  Highlighter,
  Library,
  LibraryBig,
  type LucideIcon,
  Newspaper,
  Search,
} from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { InstallButton } from '~/client/features/install/InstallButton'
import { cn } from '~/client/lib/cn'
import { HUE_CLASSES } from '~/client/lib/hue-classes'
import type { Viewer } from '~/server/auth'
import type { getNavData } from '~/server/functions'
import { isObject } from '~/shared/lib/json-shape'
import { AccountMenu, SignInLink } from './AccountMenu'
import { AppLink } from './AppLink'
import { useCommandPalette } from './CommandPalette'
import { BrandLink } from './Logo'
import { activeMainItem, isCollectionActive, type MainItem } from './nav-state'
import { ThemeToggle } from './ThemeToggle'

export type NavData = Awaited<ReturnType<typeof getNavData>>

export function AppSidebar({ nav, viewer }: { nav: NavData; viewer: Viewer | null }) {
  return (
    <aside
      data-app-sidebar
      data-chrome
      data-site-chrome
      aria-label="Site navigation"
      className="sticky top-0 hidden h-dvh w-[var(--sidebar-w)] shrink-0 flex-col overflow-y-auto border-r border-line-soft bg-inset px-4 py-6 lg:flex [html[data-hide-top-bar=on]_&]:hidden"
    >
      <SidebarContent nav={nav} viewer={viewer} />
    </aside>
  )
}

export function SearchButton({ className, onOpen }: { className?: string; onOpen?: () => void }) {
  const palette = useCommandPalette()
  return (
    <button
      type="button"
      onClick={() => {
        onOpen?.()
        palette.setOpen(true)
      }}
      data-testid="search-open"
      className={cn(
        'flex h-11 items-center gap-2.5 rounded-xl border border-line bg-surface pr-2 pl-3.5 text-left text-[14px] text-subtle transition hover:border-accent-line hover:text-body',
        className,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate">Search the library…</span>
      <kbd className="rounded-md border border-line px-1.5 py-0.5 font-sans text-[11px] text-subtle">Ctrl K</kbd>
    </button>
  )
}

const VIEWER_ITEMS = [
  { href: '/account/books', key: 'my-books', label: 'My books', icon: LibraryBig },
  { href: '/account/articles', key: 'articles', label: 'Articles', icon: Newspaper },
  { href: '/account/highlights', key: 'highlights', label: 'Highlights', icon: Highlighter },
  { href: '/account/stats', key: 'stats', label: 'Stats', icon: ChartNoAxesColumn },
  { href: '/account/repos', key: 'repos', label: 'Repositories', icon: FolderGit2 },
] as const satisfies readonly { href: string; key: MainItem; label: string; icon: LucideIcon }[]

const searchFilter = (search: unknown) =>
  isObject(search) && typeof search.filter === 'string' ? search.filter : undefined

export function SidebarContent({
  nav,
  viewer,
  onNavigate,
}: {
  nav: NavData
  viewer: Viewer | null
  onNavigate?: () => void
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const filter = useRouterState({ select: (s) => searchFilter(s.location.search) })
  const main = activeMainItem(pathname, filter)
  const id = useId()

  return (
    <div className="flex min-h-full flex-1 flex-col gap-7">
      <div className="flex flex-col gap-4">
        <BrandLink onClick={onNavigate} />
        <SearchButton className="w-full" onOpen={onNavigate} />
      </div>

      <nav aria-label="Main" className="flex flex-col gap-1">
        <NavItem href="/library" navKey="library" active={main === 'library'} onNavigate={onNavigate} icon={Library}>
          Library
        </NavItem>
        {nav.stats.audiobooks > 0 && (
          <NavItem
            href="/library?filter=audio"
            navKey="listen"
            active={main === 'listen'}
            onNavigate={onNavigate}
            icon={Headphones}
          >
            Listen
          </NavItem>
        )}
        {viewer &&
          VIEWER_ITEMS.map((item) => (
            <NavItem
              key={item.key}
              href={item.href}
              navKey={item.key}
              active={main === item.key}
              onNavigate={onNavigate}
              icon={item.icon}
            >
              {item.label}
            </NavItem>
          ))}
      </nav>

      <section aria-labelledby={`${id}-collections`}>
        <h2 id={`${id}-collections`} className="eyebrow mx-3 mb-2 text-subtle">
          Collections
        </h2>
        <ul className="flex flex-col gap-0.5">
          {nav.collections.map((collection) => {
            const active = isCollectionActive(collection, pathname, filter)
            return (
              <li key={collection.slug}>
                <AppLink
                  href={collection.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={itemClass(active)}
                  data-testid="nav-collection"
                  data-key={collection.slug}
                >
                  <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', HUE_CLASSES[collection.hue].dot)} />
                  <span className="min-w-0 flex-1 truncate">{collection.title}</span>
                  <span className="text-[13px] font-normal text-subtle tabular">{collection.bookCount}</span>
                </AppLink>
              </li>
            )
          })}
          <li>
            <AppLink href="/library" onClick={onNavigate} className={itemClass(false)} data-testid="nav-all-books">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full border border-faint" />
              All books
            </AppLink>
          </li>
        </ul>
      </section>

      {nav.featured.length > 0 && (
        <section aria-labelledby={`${id}-featured`}>
          <h2 id={`${id}-featured`} className="eyebrow mx-3 mb-2 text-subtle">
            Featured series
          </h2>
          <ul className="flex flex-col gap-0.5">
            {nav.featured.map((series) => {
              const href = `/library/${series.slug}`
              const active = pathname === href
              return (
                <li key={series.slug}>
                  <AppLink
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn('block rounded-xl px-3 py-2 transition', active ? 'bg-panel' : 'hover:bg-panel/60')}
                    data-testid="nav-series"
                    data-key={series.slug}
                  >
                    <span className="block text-[15px] font-medium text-ink">{series.title}</span>
                    <span className="block text-[13px] text-subtle">{series.subtitle}</span>
                  </AppLink>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <InstallButton />
        <div className="flex items-center gap-2">
          {viewer ? (
            <AccountMenu viewer={viewer} placement="up" className="min-w-0 flex-1" />
          ) : (
            <SignInLink
              onClick={onNavigate}
              className="flex-1 rounded-xl bg-accent-fill text-on-accent hover:brightness-105"
            />
          )}
          <ThemeToggle className="grid size-11 shrink-0 place-items-center rounded-xl border border-line text-body transition hover:bg-panel hover:text-ink" />
        </div>
      </div>
    </div>
  )
}

const itemClass = (active: boolean) =>
  cn(
    'flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition',
    active ? 'bg-panel font-semibold text-ink' : 'font-medium text-body hover:bg-panel/60 hover:text-ink',
  )

function NavItem({
  href,
  navKey,
  active,
  icon: Icon,
  onNavigate,
  children,
}: {
  href: string
  navKey: string
  active: boolean
  icon: LucideIcon
  onNavigate?: () => void
  children: ReactNode
}) {
  return (
    <AppLink
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={itemClass(active)}
      data-testid="nav-link"
      data-key={navKey}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden />
      {children}
    </AppLink>
  )
}
