import { Play } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { cn } from '~/client/lib/cn'
import { isRunLang, type RunLang } from '~/shared/run-code/langs'
import type { RunTarget } from './RunDialog'
import { openLabel } from './run-messages'

export interface RunCode {
  open(target: RunTarget): void
}

export const RunCodeContext = createContext<RunCode | null>(null)

export function RunOpenButton({
  lang,
  onOpen,
  n: listingNumber,
  tone,
  style,
}: {
  lang: RunLang
  onOpen: (opener: HTMLButtonElement) => void
  n: number
  tone: 'reader' | 'site'
  style?: React.CSSProperties
}) {
  return (
    <button
      type="button"
      data-testid="run-open"
      data-key={listingNumber}
      aria-label={openLabel(lang)}
      onClick={(e) => onOpen(e.currentTarget)}
      style={style}
      className={cn(
        'pointer-events-auto absolute inline-flex h-7 items-center gap-1 rounded-md border px-2 font-sans text-[12.5px] leading-none font-semibold shadow-sm transition',
        tone === 'reader'
          ? 'border-r-line bg-r-paper text-r-ink hover:border-r-accent/60 hover:text-r-accent'
          : 'top-2 right-2 border-line bg-surface text-ink hover:border-accent-line hover:bg-panel',
      )}
    >
      <Play className="size-3" aria-hidden />
      Run
    </button>
  )
}

interface Placed {
  n: number
  lang: RunLang
  top: number
  right: number
  pre: HTMLElement
}

export function RunButtons({ path, html }: { path: string; html: string }) {
  const run = useContext(RunCodeContext)
  const layer = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState<readonly Placed[]>([])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page's html is the trigger, not a value used inside.
  useEffect(() => {
    const el = layer.current
    const root = el?.parentElement?.querySelector<HTMLElement>(':scope > [data-highlight-root]')
    if (!run || !el || !root) {
      setPlaced([])
      return
    }
    const listings = [...root.querySelectorAll<HTMLElement>('pre[data-lang]')].filter((pre) =>
      isRunLang(pre.dataset.lang),
    )
    const measure = () => {
      const base = el.getBoundingClientRect()
      setPlaced(
        listings.map((pre, i) => {
          const box = pre.getBoundingClientRect()
          return {
            n: i + 1,
            lang: pre.dataset.lang as RunLang,
            top: box.top - base.top,
            right: base.right - box.right,
            pre,
          }
        }),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    for (const pre of listings) observer.observe(pre)
    void document.fonts?.ready.then(measure)
    return () => observer.disconnect()
  }, [run, html])

  if (!run) return null
  return (
    <div ref={layer} data-run-layer className="pointer-events-none absolute inset-0 select-none">
      {placed.map((block) => (
        <RunOpenButton
          key={block.n}
          lang={block.lang}
          n={block.n}
          tone="reader"
          style={{ top: block.top + 6, right: block.right + 6 }}
          onOpen={(opener) =>
            run.open({ lang: block.lang, code: block.pre.textContent ?? '', key: `${path}#${block.n}`, opener })
          }
        />
      ))}
    </div>
  )
}
