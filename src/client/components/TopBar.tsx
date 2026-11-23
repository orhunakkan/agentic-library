import { Menu, Search } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '~/client/lib/cn'
import type { Viewer } from '~/server/auth'
import { AccountMenu, SignInLink } from './AccountMenu'
import { type NavData, SearchButton } from './AppSidebar'
import { useCommandPalette } from './CommandPalette'
import { BrandLink } from './Logo'
import { NavDrawer } from './NavDrawer'
import { ThemeToggle } from './ThemeToggle'

const iconButton =
  'grid size-11 shrink-0 place-items-center rounded-full text-body transition hover:bg-panel hover:text-ink'

export function TopBar({ nav, viewer, alwaysShown }: { nav: NavData; viewer: Viewer | null; alwaysShown: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const drawerId = useId()
  const palette = useCommandPalette()
  return (
    <header
      data-chrome
      data-site-chrome
      className={cn(
        'sticky top-0 z-50 h-[var(--site-nav-h)] border-b border-line-soft bg-page/90 backdrop-blur-xl [html[data-hide-top-bar=on]_&]:hidden',
        !alwaysShown && 'lg:hidden',
      )}
    >
      <div className="flex h-full items-center gap-1 px-4 md:px-6">
        <BrandLink />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            aria-label="Search"
            data-testid="search-open"
            className={cn(iconButton, 'lg:hidden')}
          >
            <Search className="size-[18px]" aria-hidden />
          </button>
          <SearchButton className="mr-1 hidden w-[260px] lg:flex" />
          <ThemeToggle className={iconButton} />
          {viewer ? (
            <AccountMenu viewer={viewer} placement="down" />
          ) : (
            <SignInLink className="rounded-full px-3 font-medium text-body hover:bg-panel hover:text-ink" />
          )}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls={drawerId}
            data-testid="nav-menu-open"
            className={iconButton}
          >
            <Menu className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      <NavDrawer id={drawerId} open={menuOpen} onOpenChange={setMenuOpen} nav={nav} viewer={viewer} />
    </header>
  )
}
