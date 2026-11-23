import { cn } from '~/client/lib/cn'

type Size = 'compact' | 'large'

const SIZES: Record<Size, string> = {
  compact: 'h-10 px-3.5 text-[14px] sm:h-11 sm:px-4.5 sm:text-[15px]',
  large: 'h-12 px-6 text-[16px]',
}

export function primaryButton(size: Size = 'large'): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent-fill font-semibold whitespace-nowrap text-on-accent transition hover:brightness-95',
    SIZES[size],
  )
}

export function secondaryButton(size: Size = 'large'): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-surface font-semibold whitespace-nowrap text-ink transition hover:border-accent-line hover:bg-panel',
    SIZES[size],
  )
}
