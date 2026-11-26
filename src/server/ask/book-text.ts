import { htmlTextBlocks } from '~/shared/content/html-text'
import { chapterPageHref, pagedHref, pageLabel } from '~/shared/content/navigation'
import type { BookContent, Inline, PagedBook, PagedPage } from '~/shared/content/schema'

export interface PageText {
  href: string
  label: string
  heading: string
  chapterIndex: number
  printedPage: number | null
  blocks: string[]
}

export interface ChapterText {
  title: string
  slug: string | null
  firstPage: number
  pageCount: number
}

export interface BookText {
  kind: BookContent['kind']
  chapters: ChapterText[]
  pages: PageText[]
}

const inlineText = (content: readonly Inline[]) =>
  content.map((i) => (i.type === 'footnoteRef' ? `[${i.text}]` : i.text)).join('')

/** A printed page's text blocks: each heading joined to the block after it, then its footnotes as one block. */
function pagedPageBlocks(page: PagedPage): string[] {
  const blocks: string[] = []
  let heading = ''
  for (const block of page.blocks) {
    const text = inlineText(block.content).trim()
    if (!text) continue
    if (block.type === 'heading') heading = heading ? `${heading}\n${text}` : text
    else {
      blocks.push(heading ? `${heading}\n\n${text}` : text)
      heading = ''
    }
  }
  if (heading) blocks.push(heading)
  const notes = page.footnotes.flatMap((f) => {
    const text = inlineText(f.content).trim()
    return text ? [`[${f.id.split('_').at(-1)}] ${text}`] : []
  })
  if (notes.length) blocks.push(`Footnotes:\n${notes.join('\n')}`)
  return blocks
}

function pagedBookText(book: PagedBook): BookText {
  const chapters: ChapterText[] = book.chapters.map((c) => ({ title: c.title, slug: null, firstPage: 0, pageCount: 0 }))
  if (!chapters.length) chapters.push({ title: '', slug: null, firstPage: 0, pageCount: 0 })
  const pages: PageText[] = []
  for (const page of book.pages) {
    const chapterIndex = Math.max(
      book.chapters.findLastIndex((c) => c.startPage <= page.pageNumber),
      0,
    )
    const entry = chapters[chapterIndex] as ChapterText
    if (entry.pageCount === 0) entry.firstPage = pages.length
    entry.pageCount++

    const title = book.chapters[chapterIndex]?.title
    pages.push({
      href: pagedHref(book.slug, page.pageNumber),
      label: pageLabel({ printedPage: page.pageNumber }),
      heading: title ? `Chapter ${chapterIndex + 1}: ${title}, page ${page.pageNumber}` : `Page ${page.pageNumber}`,
      chapterIndex,
      printedPage: page.pageNumber,
      blocks: pagedPageBlocks(page),
    })
  }
  return { kind: 'paged', chapters, pages }
}

export function bookText(content: BookContent): BookText {
  if (content.kind === 'paged') return pagedBookText(content)
  const chapters: ChapterText[] = []
  const pages: PageText[] = []
  for (const [chapterIndex, chapter] of content.chapters.entries()) {
    chapters.push({
      title: chapter.title,
      slug: chapter.slug,
      firstPage: pages.length,
      pageCount: chapter.pages.length,
    })
    for (const [i, html] of chapter.pages.entries()) {
      pages.push({
        href: chapterPageHref(content.slug, chapter.slug, i + 1),
        label: pageLabel({ chapterIndex, page: i + 1 }),
        heading: `Chapter ${chapterIndex + 1}: ${chapter.title}, page ${i + 1}`,
        chapterIndex,
        printedPage: null,
        blocks: htmlTextBlocks(html),
      })
    }
  }
  return { kind: 'chapter', chapters, pages }
}
