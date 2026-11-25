import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useRef } from 'react'
import { RunButtons } from '~/client/features/run-code/RunButtons'
import type { ReaderView } from '~/shared/content/reader-view'
import { PagedContent } from './PagedContent'

export type Turn = 'forward' | 'back' | 'fade'
export type Direction = 'prev' | 'next'

export const turnFor = (direction: Direction): Turn => (direction === 'next' ? 'forward' : 'back')

export interface PageRoot {
  el: HTMLElement
  path: string
}

export type OnRoot = (root: PageRoot, mounted: boolean) => void

export const ARTICLE_CLASS =
  'prose-reader relative mx-auto w-full max-w-[calc(var(--reader-measure)+184px)] bg-r-paper px-5 pt-12 pb-12 outline-none sm:px-10 md:rounded-[3px] md:border md:border-r-line md:px-[84px] md:pt-[76px] md:pb-[92px] md:shadow-[0_24px_60px_-34px_rgba(18,28,58,.35)]'

export function Page({
  view,
  turn,
  onFootnote,
  onSwipe,
  areaRef,
  onRoot,
  corner,
}: {
  view: ReaderView
  turn: Turn
  onFootnote: (id: string) => void
  onSwipe: (direction: Direction) => void
  areaRef: React.Ref<HTMLDivElement>
  onRoot: OnRoot
  corner?: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const swipe = useSwipe(onSwipe)

  return (
    <div ref={areaRef} className="px-0 pt-0 md:px-6 md:pt-6 [perspective:2000px]">
      <AnimatePresence mode="wait" custom={turn} initial={false}>
        <motion.article
          key={view.canonicalPath}
          id="reader-content"
          data-testid="reader-page"
          data-key={view.canonicalPath}
          tabIndex={-1}
          lang={view.book.language}
          custom={turn}
          variants={reduce ? REDUCED_VARIANTS : TURN_VARIANTS}
          initial="enter"
          animate="center"
          exit="exit"
          onTouchStart={swipe.onTouchStart}
          onTouchEnd={swipe.onTouchEnd}
          className={`${ARTICLE_CLASS} md:mt-12 fullscreen:md:mt-6`}
        >
          <PageBody view={view} onFootnote={onFootnote} onRoot={onRoot} corner={corner} />
        </motion.article>
      </AnimatePresence>
    </div>
  )
}

export function PageBody({
  view,
  onFootnote,
  onRoot,
  corner,
}: {
  view: ReaderView
  onFootnote: (id: string) => void
  onRoot: OnRoot
  corner?: React.ReactNode
}) {
  const path = view.canonicalPath
  const rootRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      onRoot({ el, path }, true)
      return () => onRoot({ el, path }, false)
    },
    [onRoot, path],
  )

  return (
    <>
      {corner}
      {view.isChapterStart && (
        <header className="mb-10 font-sans">
          <p className="eyebrow text-r-accent">Chapter {view.chapterIndex + 1}</p>
          <h1
            data-testid="reader-chapter-title"
            className="mt-3 font-reader text-[clamp(28px,1.6em,40px)] leading-[1.15] font-medium tracking-[-0.015em] text-balance text-r-ink"
          >
            {view.chapterTitle}
          </h1>
          <div className="mt-6 h-[2px] w-16 bg-r-accent" aria-hidden />
        </header>
      )}
      {view.page.kind === 'paged' ? (
        <>
          <PagedContent
            blocks={view.page.blocks}
            footnotes={view.page.footnotes}
            onFootnote={onFootnote}
            highlightRoot={rootRef}
          />
          <p data-testid="reader-page-number" className="mt-12 text-center font-sans text-[13px] text-r-muted tabular">
            <span className="sr-only">Page </span>
            {view.page.pageNumber}
          </p>
        </>
      ) : (
        <>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: chapter HTML is sanitised at import time (scripts/ingest). */}
          <div ref={rootRef} data-highlight-root dangerouslySetInnerHTML={{ __html: view.page.html }} />
          <RunButtons path={view.canonicalPath} html={view.page.html} />
        </>
      )}
    </>
  )
}

const TURN_VARIANTS = {
  enter: (t: Turn) => (t === 'fade' ? { opacity: 0, y: 14 } : { opacity: 0, x: t === 'forward' ? 28 : -28 }),
  center: {
    opacity: 1,
    x: 0,
    y: 0,
    rotateY: 0,
    scale: 1,
    transition: { duration: 0.34, ease: [0.2, 0.72, 0.28, 1] as const },
  },
  exit: (turn: Turn) =>
    turn === 'fade'
      ? { opacity: 0, transition: { duration: 0.14 } }
      : {
          opacity: 0.22,
          rotateY: turn === 'forward' ? -6 : 6,
          x: turn === 'forward' ? -14 : 14,
          scale: 0.98,
          transition: { duration: 0.2, ease: 'easeIn' as const },
        },
}

const REDUCED_VARIANTS = {
  enter: () => ({ opacity: 0 }),
  center: { opacity: 1, transition: { duration: 0.12 } },
  exit: () => ({ opacity: 0, transition: { duration: 0.08 } }),
}

function useSwipe(onSwipe: (direction: Direction) => void) {
  const touch = useRef<{ x: number; y: number; t: number } | null>(null)
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      touch.current = t ? { x: t.clientX, y: t.clientY, t: Date.now() } : null
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = touch.current
      const endTouch = e.changedTouches[0]
      touch.current = null
      if (!start || !endTouch || window.getSelection()?.toString()) return
      const dx = endTouch.clientX - start.x
      const dy = endTouch.clientY - start.y
      if (Math.abs(dx) >= 64 && Math.abs(dx) >= 1.5 * Math.abs(dy) && Date.now() - start.t <= 800)
        onSwipe(dx < 0 ? 'next' : 'prev')
    },
  }
}
