import { Link, useRouteContext } from '@tanstack/react-router'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '~/client/lib/cn'

export function AccountPage({
  eyebrow,
  title,
  titleTestId,
  lead,
  nav = false,
  children,
}: {
  eyebrow: string
  title: string
  titleTestId: string
  lead?: ReactNode
  nav?: boolean
  children: ReactNode
}) {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-[720px] px-4 pt-12 md:px-8 md:pt-16"
      style={{ paddingBottom: 'calc(96px + var(--player-h))' }}
    >
      <p className="eyebrow text-accent">{eyebrow}</p>
      <h1
        className="mt-3 font-display text-[clamp(34px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.03em] text-ink"
        data-testid={titleTestId}
      >
        {title}
      </h1>
      {lead && <p className="mt-3 max-w-[60ch] text-[16px] leading-relaxed text-muted">{lead}</p>}
      {nav && <AccountNav />}
      {children}
    </main>
  )
}

const ACCOUNT_TABS = [
  { to: '/account', label: 'Account', exact: true, key: 'account' },
  { to: '/account/books', label: 'My books', exact: false, key: 'books' },
  { to: '/account/highlights', label: 'Highlights', exact: false, key: 'highlights' },
  { to: '/account/flashcards', label: 'Flashcards', exact: false, key: 'flashcards' },
  { to: '/account/prompts', label: 'Prompts', exact: false, key: 'prompts' },
  { to: '/account/api-keys', label: 'API keys', exact: false, key: 'api-keys' },
] as const
const USERS_TAB = { to: '/account/users', label: 'Users', exact: false, key: 'users' } as const

function AccountNav() {
  const { viewer } = useRouteContext({ from: '__root__' })
  const tabs = viewer?.role === 'admin' ? [...ACCOUNT_TABS, USERS_TAB] : ACCOUNT_TABS
  const tab =
    'inline-flex h-11 items-center rounded-full px-4 text-[14px] font-semibold text-muted transition hover:bg-panel/60 hover:text-ink'
  return (
    <nav aria-label="Account" className="mt-6 flex flex-wrap gap-1 border-b border-line pb-3">
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          activeOptions={{ exact: t.exact }}
          className={tab}
          activeProps={{ className: 'bg-panel text-ink', 'aria-current': 'page' }}
          data-testid="account-tab"
          data-key={t.key}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

export function Section({
  id,
  title,
  titleTestId,
  children,
}: {
  id: string
  title: string
  titleTestId?: string
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-[calc(var(--site-nav-h)+24px)]">
      <h2
        id={`${id}-title`}
        className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink"
        data-testid={titleTestId}
      >
        {title}
      </h2>
      <div className="mt-4 rounded-[22px] border border-line bg-surface p-5 md:p-6">{children}</div>
    </section>
  )
}

const NOTICE_ICONS = { error: CircleAlert, warning: TriangleAlert, success: CircleCheck }

export function Notice({
  kind,
  id,
  children,
  'data-testid': testId,
}: {
  kind: 'error' | 'success' | 'warning'
  id?: string
  children: ReactNode
  'data-testid': string
}) {
  const Icon = NOTICE_ICONS[kind]
  return (
    <p
      id={id}
      role={kind === 'error' ? 'alert' : 'status'}
      data-testid={testId}
      className={cn(
        'mt-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[14.5px] leading-relaxed',
        kind === 'error' &&
          'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
        kind === 'warning' && 'border-hue-amber/40 bg-hue-amber/15 text-hue-amber-ink',
        kind === 'success' && 'border-hue-lime/30 bg-hue-lime/15 text-hue-lime-ink',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

export function TextField({
  label,
  hint,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; hint?: string; 'data-testid'?: string }) {
  const id = input.id ?? `field-${input.name}`
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[14px] font-medium text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-1 text-[13px] text-muted">
          {hint}
        </p>
      )}
      <input
        id={id}
        aria-describedby={[hintId, input['aria-describedby']].filter(Boolean).join(' ') || undefined}
        className="mt-2 h-12 w-full rounded-xl border border-line bg-page px-4 text-[16px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15 aria-[invalid=true]:border-red-500"
        {...input}
        data-testid={input['data-testid'] ?? input.name}
      />
    </div>
  )
}

export function Button({
  variant = 'primary',
  className,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger'
  'data-testid': string
}) {
  return (
    <button
      type="submit"
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent-fill text-on-accent hover:brightness-105',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:border-accent-line hover:bg-panel',
        variant === 'danger' &&
          'border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40',
        className,
      )}
      {...button}
    />
  )
}

export function DateTime({ iso, timeOnly = false }: { iso: string; timeOnly?: boolean }) {
  const date = new Date(iso)
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {timeOnly
        ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
    </time>
  )
}
