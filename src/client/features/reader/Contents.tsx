import { Drawer } from '@base-ui/react/drawer'
import { Tabs } from '@base-ui/react/tabs'
import { ArrowLeft, Bookmark, ChevronsLeft, Highlighter, List, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { cn } from '~/client/lib/cn'
import { pad2 } from '~/client/lib/format'
import type { ReaderView } from '~/shared/content/reader-view'

export type TocTab = 'contents' | 'highlights' | 'bookmarks'

export function ContentsDrawer({
  view,
  open,
  onOpenChange,
  ...tabs
}: {
  view: ReaderView
  open: boolean
  onOpenChange: (open: boolean) => void
} & TabProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="left">
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-[70] bg-black/35 backdrop-blur-[2px] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Drawer.Viewport className="fixed inset-0 z-[71] pointer-events-none">
          <Drawer.Popup
            data-tone={view.book.tone}
            data-testid="contents-drawer"
            initialFocus={() => (document.querySelector('[data-note-editor] textarea') as HTMLElement | null) ?? true}
            className="pointer-events-auto flex h-full w-[86%] max-w-[330px] flex-col bg-r-page text-r-ink shadow-2xl outline-none [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-300 ease-[cubic-bezier(.32,.72,0,1)] data-ending-style:[transform:translateX(-100%)] data-starting-style:[transform:translateX(-100%)]"
          >
            <Drawer.Title className="sr-only">Contents</Drawer.Title>
            <TocPanel view={view} onClose={() => onOpenChange(false)} {...tabs} />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

interface TabProps {
  tab: TocTab
  onTab: (tab: TocTab) => void
  highlights: React.ReactNode | null
  highlightCount: number
  bookmarks: React.ReactNode | null
  bookmarkCount: number
}

const tabClass =
  'relative -mb-px flex min-h-14 flex-col items-center justify-center gap-1 border-b-2 border-transparent px-1 text-r-muted transition hover:text-r-ink data-[active]:border-r-accent data-[active]:text-r-ink'

function Segment({ icon: Icon, label, count = 0 }: { icon: typeof List; label: string; count?: number }) {
  return (
    <>
      <Icon className="size-[18px]" aria-hidden />
      <span className="text-[12px] leading-4 font-semibold">{label}</span>{' '}
      {count > 0 && (
        <span
          data-testid="contents-tab-count"
          data-key={label.toLowerCase()}
          className="absolute top-1.5 left-[calc(50%+3px)] min-w-[18px] rounded-full bg-r-accent px-1 text-center text-[10.5px] leading-4 font-semibold text-r-paper tabular"
        >
          {count}
        </span>
      )}
    </>
  )
}

export function TocPanel({
  view,
  onCollapse,
  onClose,
  tab: chosen,
  onTab,
  highlights,
  highlightCount,
  bookmarks,
  bookmarkCount,
}: { view: ReaderView; onCollapse?: () => void; onClose?: () => void } & TabProps) {
  const listRef = useRef<HTMLElement>(null)
  const tab = highlights === null ? 'contents' : chosen

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-centre per page.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active =
      list.querySelector<HTMLElement>('[data-active-leaf="true"]') ??
      list.querySelector<HTMLElement>('[aria-current="page"]')
    if (!active) return
    const top = active.offsetTop - list.clientHeight / 2 + active.clientHeight / 2
    list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [view.canonicalPath, tab])

  return (
    <>
      <div className="flex min-h-[57px] items-center justify-between gap-2 border-b border-r-line py-1.5 pr-3 pl-5">
        <AppLink
          href={view.book.href}
          data-testid="contents-book-link"
          className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] text-r-muted transition hover:text-r-ink"
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          <span className="line-clamp-1">{view.book.title}</span>
        </AppLink>
        {onCollapse && (
          <button
            type="button"
            data-testid="contents-hide"
            onClick={onCollapse}
            aria-label="Hide contents panel"
            title="Hide contents panel"
            className="grid size-11 shrink-0 place-items-center rounded-full text-r-muted transition hover:bg-r-line/60 hover:text-r-ink"
          >
            <ChevronsLeft className="size-4" />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            data-testid="contents-close"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-full transition hover:bg-r-line/60"
          >
            <X className="size-5" />
          </button>
        )}
      </div>
      <Tabs.Root value={tab} onValueChange={(value) => onTab(value as TocTab)} className="flex min-h-0 flex-1 flex-col">
        {highlights === null ? (
          <p className="eyebrow px-5 pt-5 pb-2 text-r-muted">Contents</p>
        ) : (
          <Tabs.List className="mb-2 grid grid-cols-3 border-b border-r-line">
            <Tabs.Tab value="contents" data-testid="contents-tab" data-key="contents" className={tabClass}>
              <Segment icon={List} label="Contents" />
            </Tabs.Tab>
            <Tabs.Tab value="highlights" data-testid="contents-tab" data-key="highlights" className={tabClass}>
              <Segment icon={Highlighter} label="Highlights" count={highlightCount} />
            </Tabs.Tab>
            <Tabs.Tab value="bookmarks" data-testid="contents-tab" data-key="bookmarks" className={tabClass}>
              <Segment icon={Bookmark} label="Bookmarks" count={bookmarkCount} />
            </Tabs.Tab>
          </Tabs.List>
        )}
        <Tabs.Panel value="contents" className="flex min-h-0 flex-1 flex-col outline-none">
          <nav
            ref={listRef}
            aria-label="Contents"
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6"
          >
            <ol>
              {view.toc.map((entry, i) => {
                const current = i === view.chapterIndex
                return (
                  <li key={entry.id}>
                    <AppLink
                      href={entry.href}
                      data-testid="contents-chapter"
                      data-key={entry.id}
                      preload={false}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'flex gap-3 rounded-r-md border-l-2 py-2 pr-2 pl-3 text-[14px] leading-snug transition',
                        current
                          ? 'border-r-accent bg-r-paper font-medium text-r-ink shadow-sm'
                          : 'border-transparent text-r-muted hover:text-r-ink',
                      )}
                    >
                      <span className="w-5 shrink-0 text-[12px] leading-[21px] tabular">{pad2(i + 1)}</span>
                      <span>{entry.title}</span>
                    </AppLink>
                    {current && entry.children.length > 0 && (
                      <ol className="mt-1 mb-2 ml-8 border-l border-r-line">
                        {entry.children.map((child) => (
                          <li key={child.id}>
                            <AppLink
                              href={child.href}
                              data-testid="contents-section"
                              data-key={child.id}
                              preload={false}
                              data-active-leaf={child.onPage}
                              className={cn(
                                '-ml-px block border-l-2 py-1.5 pr-2 pl-3 text-[13px] leading-snug transition',
                                child.onPage
                                  ? 'border-r-accent font-medium text-r-accent'
                                  : 'border-transparent text-r-muted hover:text-r-ink',
                              )}
                            >
                              {child.title}
                            </AppLink>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>
        </Tabs.Panel>
        {highlights !== null && (
          <Tabs.Panel
            value="highlights"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 outline-none"
          >
            {highlights}
          </Tabs.Panel>
        )}
        {bookmarks !== null && (
          <Tabs.Panel value="bookmarks" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 outline-none">
            {bookmarks}
          </Tabs.Panel>
        )}
      </Tabs.Root>
      <div className="border-t border-r-line px-5 py-3.5 font-serif text-[14px] text-r-muted">
        <span className="line-clamp-1">{view.chapterTitle}</span>
      </div>
    </>
  )
}
