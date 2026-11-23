import { chapterPageHref } from '~/shared/content/navigation'
import { siteOf } from '../articles/contract'
import { formatLength } from '../audiobooks/chapters'
import { type BookDetails, paragraphs } from '../import/details'
import { shortHash } from '../import/image'
import type { PlayerBook, PlayerEpisode } from './book-page'
import { renderCoverSvg } from './cover'
import { PRIVATE_SHELF_HUE } from './hues'
import type { CoverImage, Shelf, ShelfBook } from './library'
import type { ReaderContext } from './reader-view'
import type { BookMeta, ChapterBook, CoverStyle } from './schema'

export const PRIVATE_SLUG = /^u-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const privateSlug = (id: string) => `u-${id}`

export function privateBookId(slug: string): string | null {
  return PRIVATE_SLUG.test(slug) ? slug.slice(2) : null
}

export const MY_BOOKS_HREF = '/account/books'
export const MY_SHELF = {
  slug: 'my-shelf',
  title: 'My shelf',
  description: 'Books you imported. Only you can see them.',
} as const

export const ARTICLES_HREF = '/account/articles'

export const MY_ARTICLES = {
  slug: 'articles',
  title: 'Articles',
  description: 'Web articles you saved. Only you can see them.',
} as const

const COVERS: CoverStyle[] = [
  { background: ['#1d2a4f', '#3c5aa6'], ink: '#e8eefc', motif: 'rings' },
  { background: ['#3b1f2b', '#8a3b52'], ink: '#fbe9ef', motif: 'arch' },
  { background: ['#1f3a33', '#3f8a72'], ink: '#e6f6f0', motif: 'leaf' },
  { background: ['#3a2a12', '#a06a1c'], ink: '#fdf1dc', motif: 'wave' },
  { background: ['#2a2140', '#6b52a8'], ink: '#efe9fb', motif: 'star' },
  { background: ['#222831', '#56657a'], ink: '#eef2f7', motif: 'grid' },
]

export function privateCover(title: string): CoverStyle {
  let hash = 7
  for (const ch of title) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0
  return COVERS[Math.abs(hash) % COVERS.length] as CoverStyle
}

export function privateCoverUrl(title: string, author: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderCoverSvg({ title, author, cover: privateCover(title) }))}`
}

export const coverUrlOf = (image: CoverImage | null, title: string, author: string) =>
  image?.src ?? privateCoverUrl(title, author)

export type CoverSource = 'epub' | 'zip' | 'pdf' | 'audio' | 'upload' | 'open-library'

export interface PrivateCoverMeta {
  width: number
  height: number
  sha256: string
  source: CoverSource
}

export const privateBookHref = (id: string) => `${MY_BOOKS_HREF}/${id}`

export function privateCoverImage(id: string, cover: PrivateCoverMeta | null): CoverImage | null {
  return cover
    ? { src: `${privateBookHref(id)}/cover?v=${shortHash(cover.sha256)}`, width: cover.width, height: cover.height }
    : null
}

export interface PrivateBookInfo {
  id: string
  title: string
  author: string
  language: string
  chapterCount: number
  description?: string | null
  cover?: PrivateCoverMeta | null
}

export function privateReaderContext(book: PrivateBookInfo): ReaderContext {
  const page = privateBookHref(book.id)
  const meta: BookMeta = {
    id: book.id,
    slug: privateSlug(book.id),
    title: book.title,
    author: book.author,
    seriesSlug: MY_SHELF.slug,
    order: 1,
    shortDescription: book.description ?? '',
    language: book.language,
    kind: 'chapter',
    cover: privateCover(book.title),
    chapterCount: book.chapterCount,
    source: { name: 'Imported by you', url: page, license: 'Private to your account' },
  }
  const image = privateCoverImage(book.id, book.cover ?? null)
  return {
    meta,
    catalog: {
      collections: [
        { slug: MY_SHELF.slug, title: MY_SHELF.title, tagline: '', kind: 'chapter', tone: 'default', order: 0 },
      ],
      series: [
        {
          slug: MY_SHELF.slug,
          title: MY_SHELF.title,
          description: MY_SHELF.description,
          collectionSlug: MY_SHELF.slug,
        },
      ],
      books: [meta],
    },
    bookHref: page,
    coverUrl: coverUrlOf(image, book.title, book.author),
    image,
  }
}

export function partialChapterBook(
  slug: string,
  chapters: readonly { slug: string; title: string; pageCount: number }[],
  page: { chapterSlug: string; index: number; html: string | null },
): ChapterBook {
  return {
    kind: 'chapter',
    slug,
    chapters: chapters.map((c, i) => ({
      id: `ch_${i + 1}`,
      slug: c.slug,
      title: c.title,
      pages: Array.from({ length: c.pageCount }, (_, n) =>
        c.slug === page.chapterSlug && n === page.index && page.html !== null ? page.html : '',
      ),
    })),
  }
}

export function myShelf(
  books: readonly {
    id: string
    title: string
    author: string
    cover: PrivateCoverMeta | null
    format?: 'audio' | null
  }[],
): Shelf {
  return {
    slug: MY_SHELF.slug,
    title: MY_SHELF.title,
    description: MY_SHELF.description,
    collectionSlug: MY_SHELF.slug,
    kind: 'chapter',
    tone: 'default',
    hue: PRIVATE_SHELF_HUE,
    hasAudio: books.some((b) => b.format === 'audio'),
    books: books.map((b, i): ShelfBook => {
      const image = privateCoverImage(b.id, b.cover)
      return {
        slug: privateSlug(b.id),
        title: b.title,
        author: b.author,
        order: i + 1,
        href: privateBookHref(b.id),
        coverUrl: coverUrlOf(image, b.title, b.author),
        hasAudio: b.format === 'audio',
        cover: privateCover(b.title),
        image,
      }
    }),
  }
}

export function myArticles(
  articles: readonly { id: string; title: string; author: string; cover: PrivateCoverMeta | null }[],
): Shelf {
  return {
    ...myShelf(articles),
    slug: MY_ARTICLES.slug,
    title: MY_ARTICLES.title,
    description: MY_ARTICLES.description,
    collectionSlug: MY_ARTICLES.slug,
  }
}

export const openLibraryWorkUrl = (work: string) => `https://openlibrary.org/works/${work}`

export interface PrivateBookFact {
  label: string
  value: string
  format?: 'language' | 'date'
}

export interface PrivateBookPage {
  id: string
  slug: string
  title: string
  author: string
  language: string
  cover: CoverStyle
  image: CoverImage | null
  coverSource: CoverSource | null
  details: BookDetails
  aboutParagraphs: string[]
  hasMore: boolean
  facts: PrivateBookFact[]
  startHref: string
  toc: { number: number; title: string; href: string }[]
  openLibraryUrl: string | null
  article?: { url: string; site: string; words: number; savedAt: string } | null
}

export interface PrivateBookPageInput {
  id: string
  title: string
  author: string
  language: string
  details: BookDetails
  cover: PrivateCoverMeta | null
  openLibraryWork: string | null
  readyAt: Date
  chapters: readonly { slug: string; title: string; pageCount: number }[]
  imageCount?: number
  articleUrl?: string | null
  articleWords?: number | null
}

function detailFacts(details: BookDetails): PrivateBookFact[] {
  const facts: PrivateBookFact[] = []
  if (details.isbn) facts.push({ label: 'ISBN', value: details.isbn })
  if (details.publisher) facts.push({ label: 'Publisher', value: details.publisher })
  if (details.publishedYear) facts.push({ label: 'Published', value: String(details.publishedYear) })
  return facts
}

const showsMore = (about: readonly string[]) => about.length > 1 || (about[0]?.length ?? 0) > 400

type PageHeader = Omit<PrivateBookPage, 'facts' | 'startHref' | 'toc'>

function pageHeader(
  book: Omit<PrivateBookPageInput, 'readyAt' | 'chapters' | 'imageCount' | 'articleUrl' | 'articleWords'>,
): PageHeader {
  const about = book.details.description ? paragraphs(book.details.description) : []
  return {
    id: book.id,
    slug: privateSlug(book.id),
    title: book.title,
    author: book.author,
    language: book.language,
    cover: privateCover(book.title),
    image: privateCoverImage(book.id, book.cover),
    coverSource: book.cover?.source ?? null,
    details: book.details,
    aboutParagraphs: about,
    hasMore: showsMore(about),
    openLibraryUrl: book.openLibraryWork ? openLibraryWorkUrl(book.openLibraryWork) : null,
  }
}

export function buildPrivateBookPage(book: PrivateBookPageInput): PrivateBookPage {
  const header = pageHeader(book)
  const { slug } = header
  const article = book.articleUrl
    ? {
        url: book.articleUrl,
        site: siteOf(book.articleUrl),
        words: book.articleWords ?? 0,
        savedAt: book.readyAt.toISOString(),
      }
    : null
  const facts: PrivateBookFact[] = [
    { label: 'Chapters', value: String(book.chapters.length) },
    ...(book.imageCount ? [{ label: 'Pictures', value: String(book.imageCount) }] : []),
    { label: 'Language', value: book.language, format: 'language' },
    { label: article ? 'Saved' : 'Imported', value: book.readyAt.toISOString(), format: 'date' },
    ...detailFacts(book.details),
  ]
  const first = book.chapters[0]
  return {
    ...header,
    article,
    facts,
    startHref: first ? chapterPageHref(slug, first.slug, 1) : `/read/${slug}`,
    toc: book.chapters.map((c, i) => ({ number: i + 1, title: c.title, href: chapterPageHref(slug, c.slug, 1) })),
  }
}

export interface AudiobookChapterInput {
  position: number
  title: string
  fileN: number
  startMs: number
  durationMs: number
}

export interface PrivateAudiobookPageInput extends Omit<PrivateBookPageInput, 'chapters' | 'imageCount'> {
  narrator: string | null
  audioMs: number
  audioBytes: number
  type: 'mp4' | 'mp3'
  fileCount: number
  chapters: readonly AudiobookChapterInput[]
}

export interface PrivateAudiobookPage extends Omit<PrivateBookPage, 'startHref' | 'toc'> {
  narrator: string | null
  player: { book: PlayerBook; episodes: PlayerEpisode[] }
}

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace(/\.0$/, '')} MB`
}

export function buildPrivateAudiobookPage(book: PrivateAudiobookPageInput): PrivateAudiobookPage {
  const header = pageHeader(book)
  const { slug, image } = header
  const files =
    book.type === 'mp4'
      ? `M4B · ${fileSize(book.audioBytes)}`
      : `${book.fileCount} MP3 ${book.fileCount === 1 ? 'file' : 'files'} · ${fileSize(book.audioBytes)}`
  const facts: PrivateBookFact[] = [
    { label: 'Audiobook', value: formatLength(book.audioMs) },
    { label: 'Chapters', value: String(book.chapters.length) },
    { label: book.fileCount === 1 ? 'File' : 'Files', value: files },
    { label: 'Language', value: book.language, format: 'language' },
    { label: 'Imported', value: book.readyAt.toISOString(), format: 'date' },
    ...detailFacts(book.details),
  ]
  const href = privateBookHref(book.id)
  return {
    ...header,
    narrator: book.narrator,
    facts,
    player: {
      book: {
        slug,
        title: book.title,
        author: book.author,
        href,
        coverUrl: coverUrlOf(image, book.title, book.author),
        cover: privateCover(book.title),
        image,
      },
      episodes: book.chapters.map((c) => ({
        id: String(c.position),
        title: c.title,
        number: c.position,
        durationMs: c.durationMs,
        audioUrl: `${href}/audio/${c.fileN}`,
        startMs: c.startMs,
        pageHref: null,
      })),
    },
  }
}
