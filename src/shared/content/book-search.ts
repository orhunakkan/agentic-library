import { chapterPageHref, pagedHref } from '~/shared/content/navigation'
import { foldText } from '~/shared/lib/search'
import { htmlParagraphs } from './html-text'
import type { BookContent } from './schema'

export interface BookSearchHit {
  href: string
  chapterTitle: string
  page: number
  snippet: { text: string; hit: boolean }[]
}

export const IN_BOOK_HIT_LIMIT = 40

function* paragraphs(
  content: BookContent,
): Generator<{ href: string; chapterTitle: string; page: number; text: string }> {
  if (content.kind === 'paged') {
    for (const page of content.pages) {
      const chapter = content.chapters.find((c) => c.startPage <= page.pageNumber && page.pageNumber <= c.endPage)
      for (const block of page.blocks) {
        const text = block.content.map((i) => i.text).join('')
        yield {
          href: pagedHref(content.slug, page.pageNumber),
          chapterTitle: chapter?.title ?? '',
          page: page.pageNumber,
          text,
        }
      }
    }
    return
  }
  for (const chapter of content.chapters) {
    for (const [i, html] of chapter.pages.entries()) {
      for (const text of htmlParagraphs(html)) {
        yield {
          href: chapterPageHref(content.slug, chapter.slug, i + 1),
          chapterTitle: chapter.title,
          page: i + 1,
          text,
        }
      }
    }
  }
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

interface Token {
  start: number
  end: number
  folded: string
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(WORD)].map((m) => ({ start: m.index, end: m.index + m[0].length, folded: foldText(m[0]) }))
}

function snippetAround(text: string, tokens: Token[], isHit: (t: Token) => boolean): BookSearchHit['snippet'] {
  const first = tokens.findIndex(isHit)
  const from = Math.max(0, first - 10)
  const to = Math.min(tokens.length - 1, first + 16)
  const snippet: BookSearchHit['snippet'] = []
  const push = (part: string, hit: boolean) => {
    const last = snippet.at(-1)
    if (last && last.hit === hit) last.text += part
    else if (part) snippet.push({ text: part, hit })
  }
  if (from > 0) push('…', false)
  let cursor = tokens[from]?.start ?? 0
  for (let i = from; i <= to; i++) {
    const t = tokens[i]
    if (!t) continue
    push(text.slice(cursor, t.start), false)
    push(text.slice(t.start, t.end), isHit(t))
    cursor = t.end
  }
  if (to < tokens.length - 1) push('…', false)
  else push(text.slice(cursor), false)
  return snippet
}

export function searchBook(content: BookContent, query: string, options: { limit?: number } = {}): BookSearchHit[] {
  const words = foldText(query).split(' ').filter(Boolean)
  if (words.join('').length < 2) return []
  const limit = options.limit ?? 50
  const isHit = (t: Token) => words.some((w) => t.folded.startsWith(w))
  const hits: BookSearchHit[] = []
  const seen = new Set<string>()

  for (const para of paragraphs(content)) {
    if (hits.length >= limit) break
    if (seen.has(para.href)) continue
    const tokens = tokenize(para.text)
    if (!words.every((w) => tokens.some((t) => t.folded.startsWith(w)))) continue
    seen.add(para.href)
    const snippet = snippetAround(para.text, tokens, isHit)
    hits.push({ href: para.href, chapterTitle: para.chapterTitle, page: para.page, snippet })
  }
  return hits
}
