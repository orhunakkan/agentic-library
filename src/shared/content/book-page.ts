import { chapterPageHref, pagedHref } from '~/shared/content/navigation'
import { collectionHues, type Hue } from './hues'
import {
  bookHref,
  type CoverImage,
  catalogCoverImage,
  coverUrlFor,
  type ShelfBook,
  seriesBooks,
  toShelfBook,
} from './library'
import { firstReadingHref } from './reader-view'
import type { AudioBook, BookContent, BookMeta, Catalog, CollectionKind, CoverStyle, Tone } from './schema'

export interface PlayerEpisode {
  id: string
  title: string
  number: number
  durationMs: number
  audioUrl: string
  startMs: number
  pageHref: string | null
}

export interface PlayerBook {
  slug: string
  title: string
  author: string
  href: string
  coverUrl: string
  cover: CoverStyle
  image: CoverImage | null
}

export interface BookPage {
  meta: BookMeta
  seriesTitle: string
  seriesSlug: string
  kind: CollectionKind
  tone: Tone
  hue: Hue
  back: { href: string; label: string }
  startHref: string
  toc: { number: number; title: string; href: string }[]
  siblings: ShelfBook[]
  audio: { book: PlayerBook; credit: string; sourceUrl: string; totalMs: number; episodes: PlayerEpisode[] } | null
}

export function buildBookPage(
  catalog: Catalog,
  content: BookContent,
  audio: AudioBook | null,
  seriesSlug: string,
  bookSlug: string,
): BookPage | null {
  const meta = catalog.books.find((b) => b.slug === bookSlug && b.seriesSlug === seriesSlug)
  const series = catalog.series.find((s) => s.slug === seriesSlug)
  const collection = catalog.collections.find((c) => c.slug === series?.collectionSlug)
  if (!meta || !series || !collection) return null

  const toc =
    content.kind === 'paged'
      ? content.chapters.map((c, i) => ({ number: i + 1, title: c.title, href: pagedHref(content.slug, c.startPage) }))
      : content.chapters.map((c, i) => ({
          number: i + 1,
          title: c.title,
          href: chapterPageHref(content.slug, c.slug, 1),
        }))

  const volumes = seriesBooks(catalog, seriesSlug)
  const index = volumes.findIndex((b) => b.slug === bookSlug)
  const siblings = nearbyVolumes(volumes, index).map(toShelfBook)

  const startHref = firstReadingHref(content)

  return {
    meta,
    seriesTitle: series.title,
    seriesSlug: series.slug,
    kind: collection.kind,
    tone: collection.tone,
    hue: collectionHues(catalog.collections).get(collection.slug) ?? 'violet',
    back:
      collection.kind === 'paged'
        ? { href: `/library/${series.slug}`, label: series.title }
        : { href: '/library', label: 'Library' },
    startHref,
    toc,
    siblings,
    audio: audio ? bookAudio(meta, content, audio) : null,
  }
}

/** A catalogue book's audiobook as the player shows it, each episode linked to the page its chapter starts on. */
export function bookAudio(meta: BookMeta, content: BookContent, audio: AudioBook): NonNullable<BookPage['audio']> {
  const startHref = firstReadingHref(content)
  const pageHref = (ref: string | undefined) => {
    if (!ref) return startHref
    if (content.kind === 'paged') {
      const chapter = content.chapters.find((c) => c.id === ref)
      return chapter ? pagedHref(content.slug, chapter.startPage) : startHref
    }
    return content.chapters.some((c) => c.slug === ref) ? chapterPageHref(content.slug, ref, 1) : startHref
  }
  return {
    book: {
      slug: meta.slug,
      title: meta.title,
      author: meta.author,
      href: bookHref(meta),
      coverUrl: coverUrlFor(meta),
      cover: meta.cover,
      image: catalogCoverImage(meta),
    },
    credit: audio.credit,
    sourceUrl: audio.sourceUrl,
    totalMs: audio.episodes.reduce((n, e) => n + e.durationMs, 0),
    episodes: audio.episodes.map((e) => ({
      id: e.id,
      title: e.title,
      number: e.number,
      durationMs: e.durationMs,
      audioUrl: e.audioUrl,
      startMs: 0,
      pageHref: pageHref(e.chapterRef),
    })),
  }
}

function nearbyVolumes(volumes: BookMeta[], index: number): BookMeta[] {
  const following = volumes.slice(index + 1, index + 5)
  return following.length > 0 ? following : volumes.slice(Math.max(0, index - 4), index)
}
