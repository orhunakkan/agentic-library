import { Dialog } from '@base-ui/react/dialog'
import { useRouter } from '@tanstack/react-router'
import { BookOpen, CornerDownLeft, Layers, Search, TextQuote } from 'lucide-react'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '~/client/lib/cn'
import { getSearchIndex } from '~/server/functions'
import { matchesQuery } from '~/shared/lib/search'

type Entry = Awaited<ReturnType<typeof getSearchIndex>>[number]

const PaletteContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
  open: false,
  setOpen: () => {},
})

export const useCommandPalette = () => useContext(PaletteContext)

const KIND_ORDER: Record<Entry['kind'], number> = { book: 0, series: 1, chapter: 2 }
const KIND_ICON = { book: BookOpen, series: Layers, chapter: TextQuote }
const KIND_LABEL = { book: 'Book', series: 'Series', chapter: 'Chapter' }

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(() => ({ open, setOpen }), [open])
  return (
    <PaletteContext.Provider value={value}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-[3px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Dialog.Popup className="fixed top-[12vh] left-1/2 z-[91] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)] transition duration-200 data-ending-style:scale-[.98] data-ending-style:opacity-0 data-starting-style:scale-[.98] data-starting-style:opacity-0">
            <Dialog.Title className="sr-only">Search the library</Dialog.Title>
            {open && <PaletteBody onClose={() => setOpen(false)} />}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </PaletteContext.Provider>
  )
}

let indexPromise: Promise<Entry[]> | undefined

export function forgetSearchIndex() {
  indexPromise = undefined
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    indexPromise ??= getSearchIndex()
    let live = true
    indexPromise.then((e) => live && setEntries(e)).catch(() => (indexPromise = undefined))
    return () => {
      live = false
    }
  }, [])

  const results = useMemo(() => {
    if (!entries) return []
    const q = query.trim()
    const pool = q
      ? entries.filter((e) => matchesQuery(q, [e.title, e.context]))
      : entries.filter((e) => e.kind !== 'chapter')
    return [...pool].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]).slice(0, 40)
  }, [entries, query])

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlight whenever the query changes.
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = (entry: Entry | undefined) => {
    if (!entry) return
    onClose()
    void router.navigate({ href: entry.href })
  }

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="size-5 shrink-0 text-subtle" aria-hidden />
        <input
          // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into.
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(results.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              go(results[active])
            }
          }}
          placeholder="Search books, series and chapters"
          aria-label="Search books, series and chapters"
          role="combobox"
          data-testid="search-input"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results[active] ? `palette-${active}` : undefined}
          className="h-14 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-subtle"
        />
        <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-subtle">Esc</kbd>
      </div>
      <div
        ref={listRef}
        id="palette-results"
        role="listbox"
        aria-label="Results"
        data-testid="search-results"
        className="max-h-[52vh] overflow-y-auto p-2"
      >
        {!entries && (
          <p className="px-3 py-6 text-center text-sm text-subtle" data-testid="search-loading">
            Loading the catalogue…
          </p>
        )}
        {entries && results.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-subtle" data-testid="search-empty">
            No results for “{query.trim()}”. Try another word.
          </p>
        )}
        {results.map((entry, i) => {
          const Icon = KIND_ICON[entry.kind]
          return (
            <div
              key={`${entry.kind}:${entry.href}`}
              id={`palette-${i}`}
              data-index={i}
              role="option"
              data-testid="search-result"
              data-key={`${entry.kind}:${entry.href}`}
              tabIndex={-1}
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => go(entry)}
              onKeyDown={() => {}}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5',
                i === active ? 'bg-panel' : 'hover:bg-panel/60',
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel text-accent">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{entry.title}</span>
                <span className="block truncate text-[13px] text-subtle">
                  {KIND_LABEL[entry.kind]} · {entry.context}
                </span>
              </span>
              {i === active && <CornerDownLeft className="size-4 text-subtle" aria-hidden />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
