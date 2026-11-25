import { shortHash } from '../import/image'
import { collectionHues, type Hue } from './hues'
import type { BookMeta, Catalog, CollectionKind, CoverStyle, Tone } from './schema'

export interface CoverImage {
  src: string
  width: number
  height: number
}

export interface ShelfBook {
  slug: string
  title: string
  author: string
  order: number
  href: string
  coverUrl: string
  hasAudio: boolean
  cover: CoverStyle
  image: CoverImage | null
}

export interface Shelf {
  slug: string
  title: string
  description: string
  collectionSlug: string
  kind: CollectionKind
  tone: Tone
  hue: Hue
  hasAudio: boolean
  books: ShelfBook[]
}

export interface CollectionSummary {
  slug: string
  title: string
  tagline: string
  kind: CollectionKind
  hue: Hue
  bookCount: number
  seriesCount: number
}

export interface Library {
  shelves: Shelf[]
  collections: CollectionSummary[]
  stats: { books: number; series: number; audiobooks: number }
}

export const bookHref = (book: Pick<BookMeta, 'slug' | 'seriesSlug'>) => `/library/${book.seriesSlug}/${book.slug}`

export function catalogCoverImage(meta: Pick<BookMeta, 'slug' | 'coverImage'>): CoverImage | null {
  const image = meta.coverImage
  if (!image) return null
  const ext = image.file.slice(image.file.lastIndexOf('.') + 1)
  return { src: `/covers/${meta.slug}-${shortHash(image.hash)}.${ext}`, width: image.width, height: image.height }
}

export const coverUrlFor = (meta: Pick<BookMeta, 'slug' | 'coverImage'>) =>
  catalogCoverImage(meta)?.src ?? `/covers/${meta.slug}.svg`

export const seriesBooks = (catalog: Catalog, seriesSlug: string): BookMeta[] =>
  catalog.books.filter((b) => b.seriesSlug === seriesSlug).sort((a, b) => a.order - b.order)

export function toShelfBook(book: BookMeta): ShelfBook {
  return {
    slug: book.slug,
    title: book.title,
    author: book.author,
    order: book.order,
    href: bookHref(book),
    coverUrl: coverUrlFor(book),
    hasAudio: book.audioDurationMs !== undefined,
    cover: book.cover,
    image: catalogCoverImage(book),
  }
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export function buildLibrary(catalog: Catalog): Library {
  const collections = [...catalog.collections].sort((a, b) => a.order - b.order)
  const collectionRank = new Map(collections.map((c, i) => [c.slug, i]))
  const collectionBySlug = new Map(collections.map((c) => [c.slug, c]))
  const hues = collectionHues(collections)

  const shelves = catalog.series
    .map((series): Shelf => {
      const collection = collectionBySlug.get(series.collectionSlug)
      if (!collection) throw new Error(`Series ${series.slug} names unknown collection ${series.collectionSlug}`)
      const books = seriesBooks(catalog, series.slug).map(toShelfBook)
      return {
        slug: series.slug,
        title: series.title,
        description: series.description,
        collectionSlug: series.collectionSlug,
        kind: collection.kind,
        tone: collection.tone,
        hue: hues.get(collection.slug) ?? 'violet',
        hasAudio: books.some((b) => b.hasAudio),
        books,
      }
    })
    .sort(
      (a, b) =>
        (collectionRank.get(a.collectionSlug) ?? 0) - (collectionRank.get(b.collectionSlug) ?? 0) ||
        collator.compare(a.title, b.title),
    )

  return {
    shelves,
    collections: collections.map((collection) => {
      const own = shelves.filter((s) => s.collectionSlug === collection.slug)
      return {
        slug: collection.slug,
        title: collection.title,
        tagline: collection.tagline,
        kind: collection.kind,
        hue: hues.get(collection.slug) ?? 'violet',
        bookCount: own.reduce((n, s) => n + s.books.length, 0),
        seriesCount: own.length,
      }
    }),
    stats: {
      books: catalog.books.length,
      series: catalog.series.length,
      audiobooks: catalog.books.filter((b) => b.audioDurationMs !== undefined).length,
    },
  }
}
