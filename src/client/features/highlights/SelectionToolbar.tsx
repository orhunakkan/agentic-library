import { AudioLines, BookA, Highlighter, Languages, Lightbulb, MessagesSquare, NotebookPen } from 'lucide-react'
import { type RefObject, useEffect, useState } from 'react'
import { QUOTE_MAX } from '~/client/features/ask/ask-client'
import type { PageRoot } from '~/client/features/reader/Page'
import { cn } from '~/client/lib/cn'
import { MAX_PASSAGE } from '~/shared/highlights/limits'
import { contextFor } from '~/shared/lookup/context'
import { lookupTerm, selectionKind } from '~/shared/lookup/term'
import { readPage, spanOf } from './dom-text'

export interface Selected {
  start: number
  end: number
  text: string
}

export interface LookupSelection {
  kind: 'term' | 'passage'
  text: string
  term: string | null
  context: string | null
  rect: DOMRect
}

interface Spot {
  quote: string
  lookup: LookupSelection | null
  passage: Selected | null
  path: string | null
  tooLong: boolean
  top: number
  left: number
  width: number
}

const BAR_H = 40
const GAP = 8

export function toolbarTop(
  rect: { top: number; bottom: number },
  { touch, viewportHeight, playerHeight }: { touch: boolean; viewportHeight: number; playerHeight: number },
): number {
  const above = rect.top - BAR_H - GAP
  const floor = viewportHeight - playerHeight - BAR_H - GAP
  if (!touch && above >= GAP) return above
  const below = rect.bottom + GAP
  if (below <= floor) return below
  return above >= GAP ? Math.min(above, floor) : floor
}

export function toolbarWidth(
  { passage, readAloud, lookup }: { passage: boolean; readAloud: boolean; lookup: boolean },
  viewportWidth: number,
) {
  const extra = lookup ? 110 : 0
  const widest = (passage ? (readAloud ? 660 : 460) : 280) + extra
  return Math.min(widest, viewportWidth - 2 * GAP)
}

const BLOCKS = 'p, li, blockquote, dd, dt, td, th, figcaption, h1, h2, h3, h4, h5, h6'

function sentenceOf(range: Range, root: HTMLElement, lang: string): string | null {
  const start = range.startContainer
  const block = (start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement)?.closest(BLOCKS)
  if (!block || !root.contains(block)) return null
  const before = document.createRange()
  before.setStart(block, 0)
  before.setEnd(range.startContainer, range.startOffset)
  const text = block.textContent ?? ''
  const from = before.toString().length
  return contextFor(text, from, Math.min(text.length, from + range.toString().length), lang)
}

function inCode(range: Range): boolean {
  const node = range.commonAncestorContainer
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return el?.closest('pre, code') != null
}

export function selectionIn(area: HTMLElement | null, selection: Selection | null): string | null {
  if (!area || !selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!area.contains(range.commonAncestorContainer)) return null
  const text = selection.toString().replace(/\s+/g, ' ').trim()
  return text ? [...text].slice(0, QUOTE_MAX).join('') : null
}

function spotFor(
  area: HTMLElement | null,
  selection: Selection | null,
  {
    rootOf,
    highlighting,
    canReadAloud,
    canLookUp,
    lang,
    touch,
  }: {
    rootOf: (node: Node) => PageRoot | null
    highlighting: boolean
    canReadAloud: boolean
    canLookUp: boolean
    lang: string
    touch: boolean
  },
): Spot | null {
  const quote = selectionIn(area, selection)
  if (!quote || !selection) return null
  const range = selection.getRangeAt(0)
  let passage: Selected | null = null
  let path: string | null = null
  const root = highlighting ? (rootOf(range.startContainer) ?? rootOf(range.endContainer)) : null
  if (root?.el.isConnected) {
    const page = readPage(root.el)
    const span = spanOf(page, range)
    if (span) {
      passage = { ...span, text: page.text.slice(span.start, span.end) }
      path = root.path
    }
  }
  const tooLong = passage !== null && [...passage.text].length > MAX_PASSAGE
  const rect = range.getBoundingClientRect()
  const raw = selection.toString().trim()
  const kind = canLookUp && !inCode(range) ? selectionKind(raw) : null
  const lookup: LookupSelection | null = kind
    ? {
        kind,
        text: raw,
        term: kind === 'term' ? lookupTerm(raw) : null,
        context: kind === 'term' && passage && root ? sentenceOf(range, root.el, lang) : null,
        rect,
      }
    : null
  const width = toolbarWidth(
    { passage: passage !== null, readAloud: canReadAloud, lookup: lookup !== null },
    window.innerWidth,
  )
  const left = Math.min(Math.max(GAP, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - GAP)
  const playerH = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--player-h')) || 0
  const top = toolbarTop(rect, { touch, viewportHeight: window.innerHeight, playerHeight: playerH })
  return { quote, lookup, passage, path, tooLong, top, left, width }
}

export function SelectionToolbar({
  area,
  rootOf,
  highlighting,
  onAsk,
  onExplain,
  explainDisabled,
  onHighlight,
  onReadAloud,
  lang,
  onLookUp,
}: {
  area: RefObject<HTMLElement | null>
  rootOf: (node: Node) => PageRoot | null
  highlighting: boolean
  onAsk: (quote: string) => void
  onExplain: (quote: string) => void
  explainDisabled: boolean
  onHighlight: (passage: Selected, withNote: boolean, path: string) => void
  onReadAloud?: (start: number, path: string) => void
  lang: string
  onLookUp?: (selection: LookupSelection) => void
}) {
  const [spot, setSpot] = useState<Spot | null>(null)
  const canReadAloud = onReadAloud !== undefined
  const canLookUp = onLookUp !== undefined

  useEffect(() => {
    let timer = 0
    const touch = window.matchMedia('(pointer: coarse)').matches
    const place = () =>
      setSpot(
        spotFor(area.current, document.getSelection(), { rootOf, highlighting, canReadAloud, canLookUp, lang, touch }),
      )
    const onChange = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(place, 120)
    }
    document.addEventListener('selectionchange', onChange)
    window.addEventListener('scroll', onChange, { passive: true, capture: true })
    window.addEventListener('resize', onChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', onChange)
      window.removeEventListener('scroll', onChange, { capture: true })
      window.removeEventListener('resize', onChange)
    }
  }, [area, rootOf, highlighting, canReadAloud, canLookUp, lang])

  if (!spot) return null
  const button =
    'inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-full px-3.5 max-[559px]:gap-1.5 max-[559px]:px-2.5 font-sans text-[13.5px] font-medium text-r-ink transition hover:bg-r-line/60 focus-visible:outline-2 focus-visible:outline-r-accent disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent'
  const keep = (e: React.MouseEvent) => e.preventDefault()
  const passage = spot.passage
  const path = spot.path ?? ''
  const tooLongTitle = spot.tooLong ? 'Select less than about a page to highlight it' : undefined
  return (
    <div
      data-chrome
      data-testid="selection-toolbar"
      style={{ top: spot.top, left: spot.left, maxWidth: spot.width }}
      className="fixed z-[60] flex items-center gap-0.5 rounded-full border border-r-line bg-r-paper p-0.5 shadow-[0_12px_30px_-12px_rgba(9,13,27,.45)] embed:hidden"
    >
      {passage && (
        <>
          <button
            type="button"
            onMouseDown={keep}
            disabled={spot.tooLong}
            title={tooLongTitle}
            data-testid="selection-highlight"
            onClick={() => {
              onHighlight(passage, false, path)
              setSpot(null)
            }}
            className={button}
          >
            <Highlighter className="size-4 shrink-0 text-r-accent" aria-hidden />
            Highlight
          </button>
          <button
            type="button"
            onMouseDown={keep}
            disabled={spot.tooLong}
            title={tooLongTitle}
            data-testid="selection-note"
            onClick={() => {
              onHighlight(passage, true, path)
              setSpot(null)
            }}
            className={button}
          >
            <NotebookPen className="size-4 shrink-0 text-r-accent" aria-hidden />
            <span className="max-[419px]:sr-only">Note</span>
          </button>
        </>
      )}
      <button
        type="button"
        onMouseDown={keep}
        data-testid="selection-ask"
        onClick={() => {
          onAsk(spot.quote)
          setSpot(null)
        }}
        className={cn(button, 'whitespace-nowrap')}
      >
        <MessagesSquare className="size-4 shrink-0 text-r-accent" aria-hidden />
        <span>
          Ask<span className="max-[559px]:sr-only"> about this</span>
        </span>
      </button>
      <button
        type="button"
        onMouseDown={keep}
        disabled={explainDisabled}
        title={explainDisabled ? 'Wait for the current answer to finish' : 'Explain'}
        data-testid="selection-explain"
        onClick={() => {
          onExplain(spot.quote)
          setSpot(null)
        }}
        className={cn(button, 'whitespace-nowrap')}
      >
        <Lightbulb className="size-4 shrink-0 text-r-accent" aria-hidden />
        <span className="max-[419px]:sr-only">Explain</span>
      </button>
      {spot.lookup && onLookUp && (
        <button
          type="button"
          onMouseDown={keep}
          data-testid={spot.lookup.kind === 'term' ? 'selection-look-up' : 'selection-translate'}
          onClick={() => {
            const selected = spot.lookup
            setSpot(null)
            if (selected) onLookUp(selected)
          }}
          className={cn(button, 'whitespace-nowrap')}
        >
          {spot.lookup.kind === 'term' ? (
            <BookA className="size-4 shrink-0 text-r-accent" aria-hidden />
          ) : (
            <Languages className="size-4 shrink-0 text-r-accent" aria-hidden />
          )}
          <span className="max-[419px]:sr-only">{spot.lookup.kind === 'term' ? 'Look up' : 'Translate'}</span>
        </button>
      )}
      {passage && onReadAloud && (
        <button
          type="button"
          onMouseDown={keep}
          title="Read aloud from here"
          data-testid="selection-read-aloud"
          onClick={() => {
            onReadAloud(passage.start, path)
            setSpot(null)
          }}
          className={cn(button, 'whitespace-nowrap')}
        >
          <AudioLines className="size-4 shrink-0 text-r-accent" aria-hidden />
          <span className="max-[559px]:sr-only">Read aloud from here</span>
        </button>
      )}
    </div>
  )
}
