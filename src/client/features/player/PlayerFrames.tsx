import { Slider } from '@base-ui/react/slider'
import { ChevronDown, FileText, Moon, Pause, Play } from 'lucide-react'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useRef } from 'react'
import { BookCover } from '~/client/components/BookCover'
import { cn } from '~/client/lib/cn'
import type { CoverImage } from '~/shared/content/library'
import type { CoverStyle } from '~/shared/content/schema'
import { PLAYER_HEIGHT, usePlayer } from './PlayerProvider'

type FrameCover = { title: string; author: string; cover: CoverStyle; image?: CoverImage | null }

export function DockFrame({ label: name, ratio, children }: { label: string; ratio: number; children: ReactNode }) {
  return (
    <motion.section
      data-chrome
      aria-label={name}
      data-testid="player-dock"
      initial={{ y: PLAYER_HEIGHT + 20 }}
      animate={{ y: 0 }}
      exit={{ y: PLAYER_HEIGHT + 20 }}
      transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      className="fixed right-0 bottom-0 z-[60] border-t border-line bg-surface/95 text-ink backdrop-blur-xl"
      style={{ height: PLAYER_HEIGHT, left: 'var(--sidebar-w)' }}
    >
      <ProgressLine ratio={ratio} />
      <div className="flex h-full items-center gap-2 px-3 md:gap-3 md:px-6">{children}</div>
    </motion.section>
  )
}

export function DockSummary({
  onOpen,
  cover,
  title,
  subtitle,
}: {
  onOpen: () => void
  cover: FrameCover
  title: string
  subtitle: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="player-open"
      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left transition hover:bg-panel"
    >
      <span className="sr-only">Open player: </span>
      <BookCover
        title={cover.title}
        author={cover.author}
        cover={cover.cover}
        image={cover.image}
        className="w-9 shrink-0 rounded-md"
      />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold" data-testid="player-dock-title">
          {title}
        </span>
        <span className="block truncate text-[13px] text-subtle" data-testid="player-dock-subtitle">
          {subtitle}
        </span>
      </span>
    </button>
  )
}

export function SleepBadge({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-[13px] whitespace-nowrap text-subtle tabular"
      data-testid="player-sleep-badge"
    >
      <Moon className="size-3.5" aria-hidden />
      <span className="max-sm:sr-only">{text.replace(/ · .*$/, ' · ')}</span>
      {text.replace(/^Sleep · /, '')}
    </span>
  )
}

export const dockButton =
  'grid size-11 shrink-0 place-items-center rounded-full text-body transition hover:bg-panel hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent'

export const pill =
  'inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-[14px] font-medium text-ink transition hover:bg-panel disabled:opacity-35 disabled:hover:bg-transparent'

function ProgressLine({ ratio }: { ratio: number }) {
  return (
    <div className="absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-line" aria-hidden>
      <div className="h-full w-full origin-left bg-accent-fill" style={{ transform: `scaleX(${ratio})` }} />
    </div>
  )
}

export function PlayButton({ size, playing, onClick }: { size: 'sm' | 'lg'; playing: boolean; onClick: () => void }) {
  const Icon = playing ? Pause : Play
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={playing ? 'Pause' : 'Play'}
      data-testid="player-play"
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-ink text-page transition hover:scale-[1.04] active:scale-95',
        size === 'sm' ? 'size-[46px]' : 'size-[74px]',
      )}
    >
      <Icon className={cn(size === 'sm' ? 'size-5' : 'size-7', !playing && 'translate-x-[1px]')} fill="currentColor" />
    </button>
  )
}

export function SheetFrame({
  cover,
  onClose,
  onToggle,
  children,
}: {
  cover: FrameCover
  onClose: () => void
  onToggle: () => void
  children: ReactNode
}) {
  const { setExpanded } = usePlayer()
  const minimizeRef = useRef<HTMLButtonElement>(null)
  const toggleRef = useRef(onToggle)
  toggleRef.current = onToggle

  useEffect(() => {
    minimizeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="menu"][data-open]')) return
      if (e.key === 'Escape') setExpanded(false)
      else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        toggleRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [setExpanded])

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      data-testid="player-sheet"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 36 }}
      className="fixed inset-0 z-[95] overflow-y-auto bg-page text-ink"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute -top-1/3 left-1/2 size-[1100px] -translate-x-1/2 opacity-20 dark:opacity-40"
          style={{ background: `radial-gradient(closest-side, ${cover.cover.background[1]}, transparent)` }}
        />
      </div>
      <div className="relative mx-auto flex min-h-full max-w-[1200px] flex-col px-5 pt-5 pb-10 md:px-10">
        <header className="grid grid-cols-[1fr_auto_1fr] items-start">
          <span />
          <div className="text-center">
            <p className="eyebrow text-accent">Now playing</p>
            <p className="mt-1 text-[14px] text-body" data-testid="player-sheet-book">
              {cover.title}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={pill} data-testid="player-close">
              Close
            </button>
            <button
              ref={minimizeRef}
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Minimize"
              data-testid="player-minimize"
              className="grid size-11 place-items-center rounded-full bg-panel text-ink transition hover:bg-panel/70"
            >
              <ChevronDown className="size-5" />
            </button>
          </div>
        </header>

        <div className="my-auto grid items-center gap-10 py-10 md:grid-cols-[minmax(240px,360px)_1fr] md:gap-16">
          <div className="mx-auto w-[min(62vw,300px)] md:w-full">
            <BookCover
              title={cover.title}
              author={cover.author}
              cover={cover.cover}
              image={cover.image}
              className="shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)]"
            />
          </div>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </motion.div>
  )
}

export function SheetTitle({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="player-sheet-title"
      className="mt-3 text-left font-display text-[clamp(28px,4vw,46px)] leading-[1.1] font-bold tracking-[-0.02em] transition hover:text-accent"
    >
      {children}
    </button>
  )
}

export function SpeedButton({ speed, onClick }: { speed: number; onClick: () => void }) {
  const text = speed.toFixed(2).replace(/0$/, '')
  return (
    <button type="button" onClick={onClick} className={pill} aria-label={`Speed ${text}x`} data-testid="player-speed">
      Speed {text}x
    </button>
  )
}

export function SheetSettings({ onGoToPage, children }: { onGoToPage?: () => void; children: ReactNode }) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-6">
      {children}
      {onGoToPage && (
        <button type="button" onClick={onGoToPage} className={pill} data-testid="player-go-to-page">
          <FileText className="size-4" aria-hidden />
          Go to page
        </button>
      )}
      <span className="ml-auto hidden text-[13px] text-subtle md:block">Esc to minimize</span>
    </div>
  )
}

export function ProgressSlider({
  value,
  max,
  step,
  valueText,
  onChange,
  onCommit,
}: {
  value: number
  max: number
  step: number
  valueText: string
  onChange?: (value: number) => void
  onCommit?: (value: number) => void
}) {
  const one = (v: number | readonly number[]) => (Array.isArray(v) ? (v[0] ?? 0) : (v as number))
  return (
    <Slider.Root
      value={value}
      min={0}
      max={Math.max(1, max)}
      step={step}
      onValueChange={(v) => onChange?.(one(v))}
      onValueCommitted={(v) => onCommit?.(one(v))}
      className="mt-8"
    >
      <Slider.Control className="flex h-6 w-full touch-none items-center">
        <Slider.Track className="h-1 w-full rounded-full bg-line">
          <Slider.Indicator className="rounded-full bg-accent-fill" />
          <Slider.Thumb
            aria-label="Progress"
            getAriaValueText={() => valueText}
            data-testid="player-progress"
            className="size-4 rounded-full bg-accent-fill shadow-[0_0_0_6px_rgb(var(--c-accent-fill)/0.18)] outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page"
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  )
}

export const roundButton =
  'grid size-11 place-items-center rounded-full transition hover:bg-panel disabled:opacity-30 disabled:hover:bg-transparent'
