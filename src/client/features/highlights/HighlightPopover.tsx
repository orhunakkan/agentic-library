import { Popover } from '@base-ui/react/popover'
import { Copy, Lightbulb, MessagesSquare, NotebookPen, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '~/client/lib/cn'
import type { Tone } from '~/shared/content/schema'
import { COLOR_NAMES, HIGHLIGHT_COLORS, type HighlightColor } from '~/shared/highlights/colors'
import type { HighlightItem } from './use-highlights'

export const SWATCH: Record<HighlightColor, string> = {
  yellow: 'bg-r-hl-yellow',
  green: 'bg-r-hl-green',
  blue: 'bg-r-hl-blue',
  pink: 'bg-r-hl-pink',
}

export function HighlightPopover({
  item,
  rect,
  tone,
  onClose,
  onColor,
  onNote,
  onAsk,
  onExplain,
  explainDisabled,
  onCopy,
  onDelete,
}: {
  item: HighlightItem | null
  rect: DOMRect | null
  tone: Tone
  onClose: () => void
  onColor: (color: HighlightColor) => void
  onNote: () => void
  onAsk: () => void
  onExplain: () => void
  explainDisabled: boolean
  onCopy: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const key = item?.key
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per highlight
  useEffect(() => setConfirming(false), [key])

  const open = item !== null && rect !== null
  const action =
    'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[14px] text-r-ink transition hover:bg-r-line/60'
  return (
    <Popover.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={rect ? { getBoundingClientRect: () => rect } : null}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[70]"
        >
          <Popover.Popup
            data-tone={tone}
            data-chrome
            data-testid="highlight-popover"
            finalFocus={() => document.getElementById('reader-content')}
            className="w-[min(272px,calc(100vw-24px))] rounded-2xl border border-r-line bg-r-paper p-2 font-sans text-r-ink shadow-[0_18px_40px_-14px_rgba(18,28,58,.35)] outline-none"
          >
            <Popover.Title className="sr-only">Highlight</Popover.Title>
            {item && (
              <>
                <fieldset className="px-3 pt-1.5 pb-2">
                  <legend className="eyebrow mb-2 text-r-muted">Colour</legend>
                  <div className="flex gap-2">
                    {HIGHLIGHT_COLORS.map((color) => (
                      <label
                        key={color}
                        title={COLOR_NAMES[color]}
                        className="relative grid size-11 place-items-center"
                      >
                        <input
                          type="radio"
                          data-testid="highlight-popover-color"
                          data-key={color}
                          name="highlight-colour"
                          value={color}
                          checked={item.color === color}
                          onChange={() => onColor(color)}
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden
                          className={cn(
                            'size-7 rounded-full border border-r-ink/20 transition peer-checked:ring-2 peer-checked:ring-r-ink peer-checked:ring-offset-2 peer-checked:ring-offset-r-paper peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-r-accent',
                            SWATCH[color],
                          )}
                        />
                        <span className="sr-only">{COLOR_NAMES[color]}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="border-t border-r-line pt-1">
                  <button type="button" data-testid="highlight-popover-note" onClick={onNote} className={action}>
                    <NotebookPen className="size-4 text-r-muted" aria-hidden />
                    {item.note ? 'Edit note' : 'Add note'}
                  </button>
                  <button type="button" data-testid="highlight-popover-ask" onClick={onAsk} className={action}>
                    <MessagesSquare className="size-4 text-r-muted" aria-hidden />
                    Ask about this
                  </button>
                  <button
                    type="button"
                    data-testid="highlight-popover-explain"
                    onClick={onExplain}
                    disabled={explainDisabled}
                    title={explainDisabled ? 'Wait for the current answer to finish' : undefined}
                    className={cn(
                      action,
                      'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent',
                    )}
                  >
                    <Lightbulb className="size-4 text-r-muted" aria-hidden />
                    Explain
                  </button>
                  <button type="button" data-testid="highlight-popover-copy" onClick={onCopy} className={action}>
                    <Copy className="size-4 text-r-muted" aria-hidden />
                    Copy
                  </button>
                  <button
                    type="button"
                    data-testid="highlight-popover-delete"
                    onClick={() => (item.note && !confirming ? setConfirming(true) : onDelete())}
                    className={cn(action, confirming && 'font-medium text-r-emph')}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {confirming ? 'Delete highlight and note?' : 'Delete'}
                  </button>
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
