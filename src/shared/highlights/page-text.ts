import { decodeEntities } from '../content/html-text.ts'
import { chapterPageHref, pagedHref, pageLabel } from '../content/navigation.ts'
import { fromStored, type PagePosition, samePosition } from '../content/position.ts'
import type { Block, BookContent } from '../content/schema.ts'

export function chapterPageText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' '))
}

export function pagedBlockText(block: Block): string {
  return block.content.map((i) => (i.type === 'footnoteRef' ? '' : i.text)).join('')
}

export function pagedPageText(blocks: readonly Block[]): string {
  return blocks.map(pagedBlockText).join('')
}

export interface BookPage {
  chapterIndex: number
  chapterTitle: string
  chapterSlug: string | null
  page: number
  href: string
  label: string
  text: string
}

export function bookPages(content: BookContent): BookPage[] {
  if (content.kind === 'chapter') {
    return content.chapters.flatMap((chapter, chapterIndex) =>
      chapter.pages.map((html, i) => ({
        chapterIndex,
        chapterTitle: chapter.title,
        chapterSlug: chapter.slug,
        page: i + 1,
        href: chapterPageHref(content.slug, chapter.slug, i + 1),
        label: pageLabel({ chapterIndex, page: i + 1 }),
        text: chapterPageText(html),
      })),
    )
  }
  return content.pages.map((page) => {
    const chapterIndex = Math.max(
      content.chapters.findLastIndex((c) => c.startPage <= page.pageNumber),
      0,
    )
    return {
      chapterIndex,
      chapterTitle: content.chapters[chapterIndex]?.title ?? '',
      chapterSlug: null,
      page: page.pageNumber,
      href: pagedHref(content.slug, page.pageNumber),
      label: pageLabel({ printedPage: page.pageNumber }),
      text: pagedPageText(page.blocks),
    }
  })
}

export function pageIndexOf(pages: readonly BookPage[], position: PagePosition): number {
  return pages.findIndex((p) => samePosition(fromStored(p.chapterSlug, p.page), position))
}
