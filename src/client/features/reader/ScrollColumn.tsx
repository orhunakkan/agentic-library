import { useRouter, useRouterState } from '@tanstack/react-router'
import { ChevronRight, ChevronUp } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { useToast } from '~/client/components/Toast'
import { cn } from '~/client/lib/cn'
import { getReaderPage } from '~/server/functions'
import type { NavTarget } from '~/shared/content/navigation'
import type { ReaderView } from '~/shared/content/reader-view'
import type { ColumnIntent } from './navigation-intent'
import { ARTICLE_CLASS, type OnRoot, PageBody } from './Page'
import {
  appended,
  type Column,
  type ColumnPage,
  columnAt,
  nextHref,
  onRouteChange,
  pageAtLine,
  prepended,
  prevHref,
  readerParams,
} from './scroll-column'

const LINE = 0.3
const HOLD_MS = 250
const SETTLE_MS = 150
const SELF_SCROLL_CAP_MS = 1500
const SETTLE_AFTER_INSERT_MS = 2000
const USER_SCROLL = ['wheel', 'touchstart', 'keydown'] as const

export interface ColumnHandle {
  reveal: (href: string, options: { scroll: boolean }) => void
  pageAtLine: () => string | null
}

export function pageName(view: ReaderView): string {
  return view.page.kind === 'paged'
    ? `Page ${view.page.pageNumber}`
    : `Page ${view.nav.status.page} of ${view.nav.status.pageCount}`
}

function useLoadPage() {
  const router = useRouter()
  return useCallback(
    async (href: string): Promise<ColumnPage | null> => {
      try {
        const matches = (await router.preloadRoute({ href } as never)) as { loaderData?: unknown }[] | undefined
        for (const match of matches ?? []) {
          const view = (match.loaderData as { view?: ReaderView } | undefined)?.view
          if (view?.canonicalPath === href) return { href, view }
        }
      } catch {}
      const params = readerParams(href)
      if (!params) return null
      try {
        const { view } = await getReaderPage({ data: params })
        return view.canonicalPath === href ? { href, view } : null
      } catch {
        return null
      }
    },
    [router],
  )
}

export function ScrollColumn({
  view,
  areaRef,
  onRoot,
  onFootnote,
  corner,
  onPages,
  intent,
  handle,
}: {
  view: ReaderView
  areaRef: React.Ref<HTMLDivElement>
  onRoot: OnRoot
  onFootnote: (path: string, id: string) => void
  corner: (page: ReaderView) => React.ReactNode
  onPages: (pages: readonly ColumnPage[]) => void
  intent: ColumnIntent
  handle: React.RefObject<ColumnHandle | null>
}) {
  const reduce = useReducedMotion()
  const toast = useToast()
  const router = useRouter()
  const loadPage = useLoadPage()
  const hash = useRouterState({ select: (s) => s.location.hash })
  const [column, setColumnState] = useState<Column>(() => columnAt(view))
  const columnRef = useRef(column)
  const setColumn = useCallback((next: Column) => {
    columnRef.current = next
    setColumnState(next)
  }, [])
  const inflight = useRef<Promise<boolean> | null>(null)
  const articles = useRef(new Map<string, HTMLElement>())
  const anchor = useRef<{ href: string; top: number } | null>(null)
  const holding = useRef<(() => void) | null>(null)
  useEffect(() => () => holding.current?.(), [])
  const held = useRef<{ href: string; timer: number } | null>(null)
  const dropHeld = useCallback(() => {
    if (held.current) window.clearTimeout(held.current.timer)
    held.current = null
  }, [])
  const scrollTarget = useRef<string | null>(null)
  const selfScroll = useRef<{ settle: number; cap: number } | null>(null)
  const routeHref = useRef(view.canonicalPath)
  routeHref.current = view.canonicalPath

  useEffect(() => onPages(column.pages), [column.pages, onPages])

  const load = useCallback(
    (end: 'next' | 'prev'): Promise<boolean> => {
      const current = columnRef.current
      if (current.loading) return inflight.current ?? Promise.resolve(false)
      const href = end === 'next' ? nextHref(current) : prevHref(current)
      if (!href) return Promise.resolve(false)
      setColumn({ ...current, loading: end, failed: current.failed === end ? null : current.failed })
      const promise = (async () => {
        const page = await loadPage(href)
        const latest = columnRef.current
        if (latest.pages[0]?.href !== current.pages[0]?.href || latest.chapterIndex !== current.chapterIndex)
          return false
        if (!page) {
          setColumn({ ...latest, loading: null, failed: end })
          if (end === 'prev') toast('Couldn’t load the earlier page')
          return false
        }
        if (end === 'prev') {
          const first = latest.pages[0]
          const el = first && articles.current.get(first.href)
          anchor.current = first && el ? { href: first.href, top: el.getBoundingClientRect().top } : null
        }
        setColumn(end === 'next' ? appended(latest, page) : prepended(latest, page))
        return true
      })()
      inflight.current = promise
      void promise.finally(() => {
        if (inflight.current === promise) inflight.current = null
      })
      return promise
    },
    [loadPage, setColumn, toast],
  )

  const endSelfScroll = useCallback(() => {
    const self = selfScroll.current
    if (!self) return
    window.clearTimeout(self.settle)
    window.clearTimeout(self.cap)
    selfScroll.current = null
  }, [])

  const scrollToPage = useCallback(
    (href: string) => {
      const el = articles.current.get(href)
      if (!el) {
        scrollTarget.current = href
        return
      }
      scrollTarget.current = null
      endSelfScroll()
      selfScroll.current = { settle: 0, cap: window.setTimeout(endSelfScroll, SELF_SCROLL_CAP_MS) }
      const nav = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--site-nav-h')) || 0
      const below = nav + (window.innerWidth >= 900 ? 16 : 48)
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - below,
        behavior: reduce ? 'auto' : 'smooth',
      })
    },
    [reduce, endSelfScroll],
  )

  const measureLine = useCallback((): string | null => {
    const pages = columnRef.current.pages
    const tops = pages.map((p) => articles.current.get(p.href)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY)
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
    return pages[pageAtLine(tops, window.innerHeight * LINE, atBottom)]?.href ?? null
  }, [])

  const reveal = useCallback(
    (href: string, { scroll }: { scroll: boolean }) => {
      const chapter = columnRef.current.pages[0]?.view.nav.dots.map((d) => d.href) ?? []
      const target = chapter.indexOf(href)
      if (target < 0) return
      if (scroll) scrollTarget.current = href
      void (async () => {
        for (let guard = 0; guard <= chapter.length; guard++) {
          const pages = columnRef.current.pages
          if (pages.some((p) => p.href === href)) break
          const first = chapter.indexOf(pages[0]?.href ?? '')
          if (!(await load(target < first ? 'prev' : 'next'))) return
        }
        if (scroll) scrollToPage(href)
      })()
    },
    [load, scrollToPage],
  )
  useEffect(() => {
    handle.current = { reveal, pageAtLine: measureLine }
    return () => {
      handle.current = null
    }
  }, [handle, reveal, measureLine])

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after the column's pages change.
  useLayoutEffect(() => {
    const at = anchor.current
    anchor.current = null
    const el = at && articles.current.get(at.href)
    const above = columnRef.current.pages[0]
    const inserted = above && articles.current.get(above.href)
    if (at && el) {
      const putBack = () => {
        const moved = el.getBoundingClientRect().top - at.top
        if (Math.abs(moved) >= 1) window.scrollBy(0, moved)
      }
      putBack()
      holding.current?.()
      const frame = window.requestAnimationFrame(putBack)
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(putBack)
      if (inserted) observer?.observe(inserted)
      const stop = () => {
        window.cancelAnimationFrame(frame)
        observer?.disconnect()
        window.clearTimeout(timer)
        for (const type of USER_SCROLL) window.removeEventListener(type, stop)
        if (holding.current === stop) holding.current = null
      }
      const timer = window.setTimeout(stop, SETTLE_AFTER_INSERT_MS)
      for (const type of USER_SCROLL) window.addEventListener(type, stop, { passive: true })
      holding.current = stop
    }
    if (scrollTarget.current && articles.current.has(scrollTarget.current)) scrollToPage(scrollTarget.current)
  }, [column.pages])

  const seenPath = useRef(view.canonicalPath)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per route page.
  useEffect(() => {
    if (seenPath.current === view.canonicalPath) return
    seenPath.current = view.canonicalPath
    dropHeld()
    const arrival = intent.arrival(view.canonicalPath)
    const change = onRouteChange(columnRef.current, view, arrival === 'leave')
    if (change.kind === 'reset') {
      endSelfScroll()
      scrollTarget.current = null
      setColumn(change.column)
      if (!/^#?highlight-/.test(hash)) window.scrollTo({ top: 0 })
      return
    }
    if (change.kind === 'scroll' && arrival === 'place' && !/^#?highlight-/.test(hash)) {
      const page = columnRef.current.pages[change.index]
      if (page) scrollToPage(page.href)
    }
  }, [view.canonicalPath])

  const sentinel = useRef<HTMLDivElement>(null)
  const canLoadNext = nextHref(column) !== null && !column.loading && column.failed !== 'next'
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new observer whenever the column's pages change.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !canLoadNext || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void load('next')
      },
      { rootMargin: '0px 0px 150% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [canLoadNext, column.pages, load])

  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const href = measureLine()
      if (!href || href === routeHref.current) return dropHeld()
      if (held.current?.href === href) return
      dropHeld()
      held.current = {
        href,
        timer: window.setTimeout(() => {
          held.current = null
          if (selfScroll.current || href === routeHref.current || measureLine() !== href) return
          if (router.latestLocation.pathname !== routeHref.current) return
          if (columnRef.current.pages.some((p) => p.href === href)) intent.follow(href)
        }, HOLD_MS),
      }
    }
    const onScroll = () => {
      const self = selfScroll.current
      if (self) {
        dropHeld()
        window.clearTimeout(self.settle)
        self.settle = window.setTimeout(() => {
          endSelfScroll()
          measure()
        }, SETTLE_MS)
        return
      }
      if (!frame) frame = window.requestAnimationFrame(measure)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.cancelAnimationFrame(frame)
      dropHeld()
      endSelfScroll()
    }
  }, [intent, measureLine, endSelfScroll, dropHeld, router])

  const last = column.pages.at(-1)?.view
  const end = last && nextHref(column) === null ? last.nav.next : null
  const canLoadPrev = prevHref(column) !== null

  return (
    <div ref={areaRef} className="px-0 pt-0 md:px-6 md:pt-6">
      <div id="reader-content" tabIndex={-1} lang={view.book.language} className="relative outline-none">
        {canLoadPrev && (
          <div className="absolute inset-x-0 top-0.5 z-10 flex justify-center md:top-[26px]">
            <button
              type="button"
              data-testid="reader-load-earlier"
              onClick={() => void load('prev')}
              disabled={column.loading === 'prev'}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-r-line bg-r-paper px-4 font-sans text-[13.5px] text-r-ink shadow-sm transition hover:border-r-accent/50 disabled:opacity-60"
            >
              <ChevronUp className="size-4" aria-hidden />
              {column.loading === 'prev' ? 'Loading the earlier page…' : 'Show earlier pages'}
            </button>
          </div>
        )}
        {column.pages.map((page, i) => (
          <div key={page.href}>
            {i > 0 && (
              <p
                aria-hidden
                className="border-t border-r-line py-2 text-center font-sans text-[12px] text-r-muted tabular md:hidden"
              >
                {pageName(page.view)}
              </p>
            )}
            <article
              ref={(el) => {
                if (!el) return
                articles.current.set(page.href, el)
                return () => {
                  if (articles.current.get(page.href) === el) articles.current.delete(page.href)
                }
              }}
              data-page-href={page.href}
              data-testid="reader-page"
              data-key={page.href}
              aria-label={pageName(page.view)}
              className={cn(ARTICLE_CLASS, i === 0 ? 'md:mt-12 fullscreen:md:mt-6' : 'md:mt-6')}
            >
              <PageBody
                view={page.view}
                onFootnote={(id) => onFootnote(page.href, id)}
                onRoot={onRoot}
                corner={corner(page.view)}
              />
            </article>
          </div>
        ))}
        <div ref={sentinel} aria-hidden />
        {(column.loading === 'next' || column.failed === 'next') && (
          <div
            role="status"
            data-testid="reader-load-next-status"
            className="flex flex-wrap items-center justify-center gap-3 py-6 font-sans text-[13.5px] text-r-muted"
          >
            {column.loading === 'next' ? (
              'Loading the next page…'
            ) : (
              <>
                Couldn’t load the next page.
                <button
                  type="button"
                  data-testid="reader-load-next-retry"
                  onClick={() => void load('next')}
                  className="inline-flex h-11 items-center rounded-full border border-r-line bg-r-paper px-4 text-r-ink transition hover:border-r-accent/50"
                >
                  Retry
                </button>
              </>
            )}
          </div>
        )}
        {end && (end.kind === 'chapter' || end.kind === 'end') && (
          <EndCard next={end} book={{ href: view.book.href, title: view.book.title }} />
        )}
      </div>
    </div>
  )
}

function EndCard({
  next,
  book,
}: {
  next: Extract<NavTarget, { kind: 'chapter' } | { kind: 'end' }>
  book: { href: string; title: string }
}) {
  const chapter = next.kind === 'chapter' ? next : null
  return (
    <AppLink
      href={chapter ? chapter.href : book.href}
      data-testid="reader-end-link"
      preload={false}
      className="mx-auto mt-6 flex min-h-11 w-full max-w-[calc(var(--reader-measure)+184px)] items-center justify-between gap-4 border-y border-r-line bg-r-paper px-5 py-5 font-sans text-r-ink transition hover:border-r-accent/50 sm:px-10 md:rounded-[3px] md:border md:px-[84px]"
    >
      <span className="min-w-0">
        <span className="eyebrow block text-r-accent">{chapter ? 'Next chapter' : 'End of book'}</span>
        <span className="mt-1 block text-[17px] font-medium text-balance">{chapter ? chapter.title : book.title}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-r-muted" aria-hidden />
    </AppLink>
  )
}
