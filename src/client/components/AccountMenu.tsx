import { Link, useRouterState } from '@tanstack/react-router'
import {
  BookMarked,
  ChartNoAxesColumn,
  ChevronDown,
  FolderGit2,
  Highlighter,
  KeyRound,
  Layers,
  LogIn,
  LogOut,
  Newspaper,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { signOutSubmit } from '~/client/features/account/sign-out'
import { cn } from '~/client/lib/cn'
import type { Viewer } from '~/server/auth'

export function SignInLink({ className, onClick }: { className?: string; onClick?: () => void }) {
  const location = useRouterState({ select: (s) => s.location })
  const next = location.pathname === '/login' ? undefined : location.href
  return (
    <Link
      to="/login"
      search={next && next !== '/library' ? { next } : {}}
      onClick={onClick}
      data-testid="sign-in-link"
      className={cn('flex h-11 items-center justify-center gap-1.5 text-[15px] font-semibold transition', className)}
    >
      <LogIn className="size-4" aria-hidden />
      Sign in
    </Link>
  )
}

const MENU_LINKS = [
  { to: '/account', label: 'Account', icon: UserRound, key: 'account' },
  { to: '/account/books', label: 'My books', icon: BookMarked, key: 'books' },
  { to: '/account/articles', label: 'Articles', icon: Newspaper, key: 'articles' },
  { to: '/account/highlights', label: 'Highlights', icon: Highlighter, key: 'highlights' },
  { to: '/account/stats', label: 'Stats', icon: ChartNoAxesColumn, key: 'stats' },
  { to: '/account/repos', label: 'Repositories', icon: FolderGit2, key: 'repos' },
  { to: '/account/flashcards', label: 'Flashcards', icon: Layers, key: 'flashcards' },
  { to: '/account/prompts', label: 'Prompts', icon: Sparkles, key: 'prompts' },
  { to: '/account/api-keys', label: 'API keys', icon: KeyRound, key: 'api-keys' },
] as const

export function AccountMenu({
  viewer,
  placement,
  className,
}: {
  viewer: Viewer
  placement: 'up' | 'down'
  className?: string
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [open, setOpen] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not a value used inside.
  useEffect(() => {
    if (ref.current) ref.current.open = false
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      const isKey = e instanceof KeyboardEvent
      if (isKey ? e.key !== 'Escape' : ref.current?.contains(e.target as Node)) return
      if (ref.current) ref.current.open = false
      if (isKey) ref.current?.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const up = placement === 'up'
  const item =
    'flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[15px] text-body transition hover:bg-panel hover:text-ink'
  return (
    <details ref={ref} className={cn('relative', className)} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary
        aria-label={`Account menu, signed in as ${viewer.username}`}
        data-testid="account-menu"
        className={cn(
          'flex h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-medium text-body transition hover:bg-panel hover:text-ink [&::-webkit-details-marker]:hidden',
          up ? 'w-full rounded-xl px-3' : 'rounded-full px-3',
        )}
      >
        <UserRound className="size-[18px] shrink-0" aria-hidden />
        <span className={cn('truncate', up ? 'flex-1 text-left' : 'hidden max-w-[12ch] md:inline')}>
          {viewer.username}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open !== up && 'rotate-180')} aria-hidden />
      </summary>
      <div
        className={cn(
          'absolute z-10 rounded-2xl border border-line bg-surface p-2 shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)]',
          up ? 'bottom-full left-0 mb-2 w-full min-w-56' : 'top-[calc(100%+10px)] right-0 w-60',
        )}
      >
        <p className="px-3 pt-1 pb-2 text-[13px] text-subtle">
          Signed in as <span className="font-medium text-ink">{viewer.username}</span>
        </p>
        {MENU_LINKS.map(({ to, label, icon: Icon, key }) => (
          <Link key={to} to={to} className={item} data-testid="account-menu-link" data-key={key}>
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        ))}
        <form method="post" action="/logout" className="mt-1 border-t border-line pt-1" onSubmit={signOutSubmit}>
          <button type="submit" className={item} data-testid="account-sign-out">
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </form>
      </div>
    </details>
  )
}
