import type { PlayerBook } from '../content/book-page.ts'
import { decodeEntities } from '../content/html-text.ts'
import { chapterPageHref, pagedHref, pageLabel } from '../content/navigation.ts'
import type { PagePosition } from '../content/position.ts'
import type { Block, BookContent } from '../content/schema.ts'
import { pagedBlockText } from '../highlights/page-text.ts'

export type SpeechBlockKind = 'text' | 'heading' | 'code'

export interface SpeechBlock {
  start: number
  end: number
  kind: SpeechBlockKind
}

export interface SpeechPageText {
  text: string
  blocks: SpeechBlock[]
}

export interface SpeechPage extends SpeechPageText {
  position: PagePosition
  href: string
  label: string
}

export interface SpeechChapter {
  index: number
  slug: string | null
  title: string
  number: number | null
  chapterCount: number
  pages: SpeechPage[]
}

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'pre',
  'td',
  'th',
  'blockquote',
  'figcaption',
  'dt',
  'dd',
])

function kindOf(tag: string): SpeechBlockKind {
  if (tag === 'pre') return 'code'
  return /^h[1-6]$/.test(tag) ? 'heading' : 'text'
}

export function chapterPageBlocks(html: string): SpeechPageText {
  let text = ''
  const blocks: SpeechBlock[] = []
  const open: { tag: string; id: number }[] = []
  let nextId = 0
  let current: { block: SpeechBlock; id: number } | null = null

  const addText = (raw: string) => {
    const chunk = decodeEntities(raw.replace(/&nbsp;/gi, ' '))
    if (!chunk) return
    const owner = open.at(-1)
    const start = text.length
    text += chunk
    const id = owner?.id ?? -1
    if (current && current.id === id && current.block.end === start) current.block.end = text.length
    else {
      const block: SpeechBlock = { start, end: text.length, kind: kindOf(owner?.tag ?? 'p') }
      blocks.push(block)
      current = { block, id }
    }
  }

  let at = 0
  for (const m of html.matchAll(/<[^>]*>/g)) {
    addText(html.slice(at, m.index))
    at = m.index + m[0].length
    const tag = /^<(\/?)([a-z][a-z0-9]*)/i.exec(m[0])
    const name = tag?.[2]?.toLowerCase() ?? ''
    if (name === 'br') {
      current = null
      continue
    }
    if (!BLOCK_TAGS.has(name)) continue
    if (tag?.[1]) {
      const index = open.findLastIndex((o) => o.tag === name)
      if (index >= 0) open.length = index
    } else open.push({ tag: name, id: nextId++ })
    current = null
  }
  addText(html.slice(at))
  return { text, blocks: blocks.filter((b) => b.end > b.start) }
}

export function pagedPageBlocks(blocks: readonly Block[]): SpeechPageText {
  let text = ''
  const spans: SpeechBlock[] = []
  for (const block of blocks) {
    const start = text.length
    text += pagedBlockText(block)
    if (text.length > start)
      spans.push({ start, end: text.length, kind: block.type === 'heading' ? 'heading' : 'text' })
  }
  return { text, blocks: spans }
}

export function speechChapter(content: BookContent, chapterIndex: number): SpeechChapter | null {
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0) return null
  if (content.kind === 'chapter') {
    const chapter = content.chapters[chapterIndex]
    return chapter ? chapterBookChapter(content.slug, chapter, chapterIndex, content.chapters.length) : null
  }
  const chapter = content.chapters[chapterIndex]
  if (!chapter) return null
  return {
    index: chapterIndex,
    slug: null,
    title: chapter.title,
    number: null,
    chapterCount: content.chapters.length,
    pages: content.pages
      .filter((p) => p.pageNumber >= chapter.startPage && p.pageNumber <= chapter.endPage)
      .map((p) => ({
        position: { printedPage: p.pageNumber },
        href: pagedHref(content.slug, p.pageNumber),
        label: pageLabel({ printedPage: p.pageNumber }),
        ...pagedPageBlocks(p.blocks),
      })),
  }
}

export function chapterBookChapter(
  bookSlug: string,
  chapter: { slug: string; title: string; pages: readonly string[] },
  chapterIndex: number,
  chapterCount: number,
): SpeechChapter {
  return {
    index: chapterIndex,
    slug: chapter.slug,
    title: chapter.title,
    number: chapterIndex + 1,
    chapterCount,
    pages: chapter.pages.map((html, i) => ({
      position: { chapter: chapter.slug, page: i + 1 },
      href: chapterPageHref(bookSlug, chapter.slug, i + 1),
      label: pageLabel({ chapterIndex, page: i + 1 }),
      ...chapterPageBlocks(html),
    })),
  }
}

export interface SpeechBook extends PlayerBook {
  language: string
  chapterTitles: string[]
}

export interface SpeechChapterData {
  book: SpeechBook
  chapter: SpeechChapter
}
