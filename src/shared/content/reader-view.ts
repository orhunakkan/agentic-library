import { buildNavigation, chapterPageHref, type Navigation, pagedHref, pageLabel } from '~/shared/content/navigation'
import { type PagePosition, readerParams } from '~/shared/content/position'
import { SITE_NAME } from '~/shared/lib/site'
import { bookHref, type CoverImage, catalogCoverImage, coverUrlFor } from './library'
import type {
  Block,
  BookContent,
  BookMeta,
  Catalog,
  ChapterBook,
  CollectionKind,
  Footnote,
  PagedBook,
  Tone,
} from './schema'

export interface TocEntry {
  id: string
  title: string
  href: string
  children: { id: string; title: string; href: string; onPage: boolean }[]
}

export type ReaderPage =
  | { kind: 'paged'; pageNumber: number; blocks: Block[]; footnotes: Footnote[] }
  | { kind: 'chapter'; html: string }

export interface ReaderView {
  book: {
    slug: string
    title: string
    author: string
    href: string
    coverUrl: string
    image: CoverImage | null
    kind: CollectionKind
    tone: Tone
    language: string
    collectionTitle: string
  }
  toc: TocEntry[]
  chapterIndex: number
  chapterTitle: string
  isChapterStart: boolean
  breadcrumbs: string[]
  documentTitle: string
  canonicalPath: string
  nav: Navigation
  page: ReaderPage
}

export interface ReaderContext {
  meta: BookMeta
  catalog: Catalog
  bookHref?: string
  coverUrl?: string
  image?: CoverImage | null
}

export function positionOf(view: ReaderView): PagePosition {
  if (view.page.kind === 'paged') return { printedPage: view.page.pageNumber }
  return { chapter: readerParams(view.canonicalPath)?.part ?? '', page: view.nav.status.page }
}

export function labelOf(view: ReaderView): string {
  return view.page.kind === 'paged'
    ? pageLabel({ printedPage: view.page.pageNumber })
    : pageLabel({ chapterIndex: view.chapterIndex, page: view.nav.status.page })
}

export function firstReadingHref(content: BookContent): string {
  if (content.kind === 'paged') return pagedHref(content.slug, content.chapters[0]?.startPage ?? content.startPage)
  const first = content.chapters[0]
  return first ? chapterPageHref(content.slug, first.slug, 1) : `/read/${content.slug}`
}

export function buildReaderView(ctx: ReaderContext, content: BookContent, part: string, n?: string): ReaderView | null {
  return content.kind === 'paged' ? pagedView(ctx, content, part, n) : chapterView(ctx, content, part, n)
}

function bookInfo({ meta, catalog, bookHref: href, coverUrl: cover, image }: ReaderContext): ReaderView['book'] {
  const series = catalog.series.find((s) => s.slug === meta.seriesSlug)
  const collection = catalog.collections.find((c) => c.slug === series?.collectionSlug)
  return {
    slug: meta.slug,
    title: meta.title,
    author: meta.author,
    href: href ?? bookHref(meta),
    coverUrl: cover ?? coverUrlFor(meta),
    image: image === undefined ? catalogCoverImage(meta) : image,
    kind: meta.kind,
    tone: collection?.tone ?? 'default',
    language: meta.language,
    collectionTitle: collection?.title ?? SITE_NAME,
  }
}

const isWholeNumber = (value: string) => /^[1-9]\d*$/.test(value)

function pagedView(ctx: ReaderContext, content: PagedBook, part: string, n?: string): ReaderView | null {
  if (n !== undefined || !isWholeNumber(part)) return null
  const pageNumber = Number(part)
  const page = content.pages.find((p) => p.pageNumber === pageNumber)
  const chapterIndex = content.chapters.findIndex((c) => c.startPage <= pageNumber && pageNumber <= c.endPage)
  const chapter = content.chapters[chapterIndex]
  if (!page || !chapter) return null

  const book = bookInfo(ctx)
  const onPage = chapter.children.filter((c) => c.pageNumber === pageNumber)
  const breadcrumbs = [book.title, chapter.title, ...onPage.map((c) => c.title)]
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => pagedHref(content.slug, from + i))

  return {
    book,
    toc: content.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      href: pagedHref(content.slug, c.startPage),
      children: c.children.map((s) => ({
        id: s.id,
        title: s.title,
        href: pagedHref(content.slug, s.pageNumber),
        onPage: s.pageNumber === pageNumber,
      })),
    })),
    chapterIndex,
    chapterTitle: chapter.title,
    isChapterStart: pageNumber === chapter.startPage,
    breadcrumbs,
    documentTitle: `${breadcrumbs.join(' › ')} | ${book.collectionTitle}`,
    canonicalPath: pagedHref(content.slug, pageNumber),
    nav: buildNavigation(
      content.chapters.map((c) => ({ title: c.title, pageHrefs: range(c.startPage, c.endPage) })),
      chapterIndex,
      pageNumber - chapter.startPage,
    ),
    page: { kind: 'paged', pageNumber, blocks: page.blocks, footnotes: page.footnotes },
  }
}

function chapterView(ctx: ReaderContext, content: ChapterBook, part: string, n?: string): ReaderView | null {
  if (n !== undefined && (!isWholeNumber(n) || n === '1')) return null
  const pageIndex = n === undefined ? 0 : Number(n) - 1
  const chapterIndex = content.chapters.findIndex((c) => c.slug === part)
  const chapter = content.chapters[chapterIndex]
  const html = chapter?.pages[pageIndex]
  if (!chapter || html === undefined) return null

  const book = bookInfo(ctx)
  const hrefs = (c: ChapterBook['chapters'][number]) =>
    c.pages.map((_, i) => chapterPageHref(content.slug, c.slug, i + 1))

  return {
    book,
    toc: content.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      href: chapterPageHref(content.slug, c.slug, 1),
      children: [],
    })),
    chapterIndex,
    chapterTitle: chapter.title,
    isChapterStart: pageIndex === 0,
    breadcrumbs: [book.title, chapter.title],
    documentTitle: `${chapter.title} | ${SITE_NAME}`,
    canonicalPath: chapterPageHref(content.slug, chapter.slug, pageIndex + 1),
    nav: buildNavigation(
      content.chapters.map((c) => ({ title: c.title, pageHrefs: hrefs(c) })),
      chapterIndex,
      pageIndex,
    ),
    page: { kind: 'chapter', html },
  }
}
