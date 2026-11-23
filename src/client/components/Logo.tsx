import { Link } from '@tanstack/react-router'
import { cn } from '~/client/lib/cn'
import { SITE_NAME } from '~/shared/lib/site'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <circle cx="16" cy="16" r="15" fill="#B8F35C" />
      <circle cx="16" cy="16" r="6" fill="#0B0D17" />
    </svg>
  )
}

export function BrandLink({ onClick }: { onClick?: () => void }) {
  return (
    <Link
      to="/library"
      onClick={onClick}
      data-testid="brand-link"
      className="flex min-h-11 items-center gap-2.5 rounded-xl px-2 font-display text-[22px] font-bold tracking-[-0.02em] text-ink"
    >
      <Logo />
      {SITE_NAME}
    </Link>
  )
}
