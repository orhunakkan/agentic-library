import { BookUp, Download, Minus, Plus } from 'lucide-react'
import { cn } from '~/client/lib/cn'
import { DEFAULT_PREFS, FONT_SIZES, LEADING_OPTIONS, THEME_OPTIONS } from '../reader/prefs'
import { Chip, PreviewCard } from './previews'
import { BOOK_FILE, CHAPTER_COUNT, HIGHLIGHTS, label } from './sample'

const DOT = { yellow: 'bg-r-hl-yellow', pink: 'bg-r-hl-pink' } as const

export function HighlightsPreview() {
  return (
    <PreviewCard className="text-[14px]">
      <p className="font-display text-[16px] font-semibold text-ink">
        Highlights{' '}
        <span className="ml-1 rounded-full bg-panel px-2 py-0.5 text-[12.5px] text-body">{HIGHLIGHTS.count}</span>
      </p>
      <ul className="mt-4 flex flex-col gap-4">
        {HIGHLIGHTS.items.map((h) => (
          <li key={h.passage.text} className="flex gap-3">
            <span className={cn('mt-1 w-1 shrink-0 self-stretch rounded-full', DOT[h.color])} />
            <div className="min-w-0">
              <p className="line-clamp-3 font-serif text-[14.5px] leading-relaxed text-ink">{h.passage.text}</p>
              {h.note && <p className="mt-1.5 text-body">{h.note}</p>}
              <p className="mt-2">
                <Chip accent>{label(h.passage)}</Chip>
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-line-soft pt-4">
        <Chip>
          <Download className="size-3.5" />
          Export as Markdown
        </Chip>
        <Chip>All highlights</Chip>
      </div>
    </PreviewCard>
  )
}

export function ImportPreview() {
  return (
    <PreviewCard className="text-[14px]">
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-6 text-center">
        <BookUp className="size-6 text-hue-pink-ink" />
        <p className="font-semibold text-ink">Drop a book here</p>
        <p className="text-[13px] text-muted">EPUB, .md, or a ZIP of Markdown</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-inset px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{BOOK_FILE}</p>
          <p className="text-[13px] text-muted">{CHAPTER_COUNT} chapters found · ready to review</p>
        </div>
        <span className="rounded-full bg-accent-fill px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap text-on-accent">
          Save to My shelf
        </span>
      </div>
    </PreviewCard>
  )
}

export function SettingsPreview() {
  const size = DEFAULT_PREFS.fontSize
  return (
    <PreviewCard className="flex flex-col gap-5 text-[13px]">
      <div className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map((theme) => (
          <span
            key={theme.value}
            className={cn(
              'flex flex-col items-center gap-1 rounded-xl border px-2 py-3',
              theme.swatch,
              theme.value === 'dark' && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
            )}
          >
            <span className="font-serif text-[20px] leading-none">Aa</span>
            <span className="text-[12.5px] font-medium">{theme.label}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full border border-line text-ink">
          <Minus className="size-3.5" />
        </span>
        <div className="flex flex-1 items-end justify-between">
          {FONT_SIZES.map((s) => (
            <span key={s} className={cn('rounded-full', s === size ? 'size-2.5 bg-accent' : 'size-1.5 bg-faint')} />
          ))}
        </div>
        <span className="grid size-8 place-items-center rounded-full border border-line text-ink">
          <Plus className="size-3.5" />
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {LEADING_OPTIONS.map((leading) => (
          <span
            key={leading.value}
            className={cn(
              'rounded-full border py-1.5 text-center font-medium',
              leading.value === DEFAULT_PREFS.leading
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line text-body',
            )}
          >
            {leading.label}
          </span>
        ))}
      </div>
    </PreviewCard>
  )
}
