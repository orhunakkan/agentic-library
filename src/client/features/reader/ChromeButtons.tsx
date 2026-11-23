import { AudioLines, MessagesSquare, Pause } from 'lucide-react'
import { cn } from '~/client/lib/cn'

const pillClass = (compact: boolean | undefined) =>
  cn(
    'shrink-0 items-center gap-2 text-r-ink transition embed:hidden',
    compact
      ? 'inline-grid size-11 place-items-center rounded-full hover:bg-r-line/60'
      : 'inline-flex h-11 rounded-full border border-r-line bg-r-paper/90 px-3.5 text-[13.5px] shadow-sm backdrop-blur hover:border-r-accent/50',
  )

export function AskButton({
  onClick,
  expanded,
  compact,
  ref,
}: {
  onClick: () => void
  expanded: boolean
  compact?: boolean
  ref?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      data-testid="reader-ask"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={compact ? 'Ask this book' : undefined}
      title="Ask this book"
      className={cn(pillClass(compact), !compact && 'aria-expanded:border-r-accent/60')}
    >
      <MessagesSquare className="size-[18px]" aria-hidden />
      {!compact && <span>Ask</span>}
    </button>
  )
}

export function ReadAloudButton({
  reading,
  onClick,
  compact,
}: {
  reading: boolean
  onClick: () => void
  compact?: boolean
}) {
  const label = reading ? 'Pause reading' : 'Read aloud'
  const Icon = reading ? Pause : AudioLines
  return (
    <button
      type="button"
      data-testid="reader-read-aloud"
      onClick={onClick}
      aria-label={compact ? label : undefined}
      title={label}
      className={pillClass(compact)}
    >
      <Icon className="size-[18px]" aria-hidden />
      {!compact && <span>{label}</span>}
    </button>
  )
}

export function IconButton({
  label,
  title,
  onClick,
  children,
  expanded,
  bordered,
  'data-testid': testId,
}: {
  label: string
  title?: string
  onClick: () => void
  children: React.ReactNode
  expanded?: boolean
  bordered?: boolean
  'data-testid': string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={title ?? label}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      onClick={onClick}
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-full text-r-ink transition',
        bordered
          ? 'border border-r-line bg-r-paper/90 shadow-sm backdrop-blur hover:border-r-accent/50'
          : 'hover:bg-r-line/60',
      )}
    >
      {children}
    </button>
  )
}
