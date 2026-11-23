import type { HighlightColor } from './colors.ts'

export interface HighlightPlace {
  chapterIndex: number
  chapterTitle: string
  chapter: string | null
  page: number
  pageHref: string
  href: string
  label: string
  position: number
  start: number
  end: number
}

export interface HighlightView {
  id: string
  color: HighlightColor
  note: string | null
  text: string
  status: 'ok' | 'moved' | 'missing'
  place: HighlightPlace | null
  createdAt: string
  updatedAt: string
}

export interface ChapterGroup {
  chapterIndex: number
  chapterTitle: string
  highlights: HighlightView[]
}

const byAge = (a: HighlightView, b: HighlightView) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

export function inReadingOrder(highlights: readonly HighlightView[]): HighlightView[] {
  return [...highlights].sort((a, b) => {
    if (a.place && b.place) return a.place.position - b.place.position || a.place.start - b.place.start || byAge(a, b)
    if (a.place || b.place) return a.place ? -1 : 1
    return byAge(a, b)
  })
}

export function groupByChapter(highlights: readonly HighlightView[]): {
  chapters: ChapterGroup[]
  missing: HighlightView[]
} {
  const chapters: ChapterGroup[] = []
  const missing: HighlightView[] = []
  for (const h of inReadingOrder(highlights)) {
    if (!h.place) {
      missing.push(h)
      continue
    }
    const last = chapters.at(-1)
    if (last?.chapterIndex === h.place.chapterIndex) last.highlights.push(h)
    else chapters.push({ chapterIndex: h.place.chapterIndex, chapterTitle: h.place.chapterTitle, highlights: [h] })
  }
  return { chapters, missing }
}
