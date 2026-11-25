import '@tanstack/react-start/server-only'
import { chapterPageHref, pageLabel } from '~/shared/content/navigation'
import { fromStored, type PagePosition } from '~/shared/content/position'
import { type BookPage, pageIndexOf } from '~/shared/highlights/page-text'
import { privateBookSlug } from '../../shared/content/book-slug.ts'
import { openBook, openTextBook } from '../books/book.ts'
import { type BookRef, refFor } from '../books/ref.ts'
import type { Db } from '../db.ts'
import { type BookOutline, loadOutlines } from '../user-books.ts'

export interface PlacePage {
  chapterIndex: number
  chapterTitle: string
  chapter: string | null
  page: number
  href: string
  label: string
  position: PagePosition
}

export interface ResolvedPlace extends PlacePage {
  ref: BookRef
  bookTitle: string
}

interface PlaceBook {
  ref: BookRef
  title: string
  find: (position: PagePosition) => PlacePage | null
  nearest: (chapter: string | null, page: number) => PlacePage | null
}

export type PlaceCache = Map<string, Promise<PlaceBook | null>>

export const newPlaceCache = (): PlaceCache => new Map()

function fromPage(p: BookPage): PlacePage {
  return {
    chapterIndex: p.chapterIndex,
    chapterTitle: p.chapterTitle,
    chapter: p.chapterSlug,
    page: p.page,
    href: p.href,
    label: p.label,
    position: fromStored(p.chapterSlug, p.page),
  }
}

function catalogueBook(ref: BookRef, title: string, pages: readonly BookPage[]): PlaceBook {
  const at = (index: number) => {
    const p = pages[index]
    return p ? fromPage(p) : null
  }
  return {
    ref,
    title,
    find: (position) => at(pageIndexOf(pages, position)),
    nearest: (chapter, page) => {
      const exact = pageIndexOf(pages, fromStored(chapter, page))
      if (exact >= 0) return at(exact)
      const chapterStart = chapter === null ? -1 : pages.findIndex((p) => p.chapterSlug === chapter)
      return at(Math.max(chapterStart, 0))
    },
  }
}

function privateBook(slug: string, ref: BookRef, outline: BookOutline): PlaceBook {
  const pageOf = (chapterIndex: number, page: number): PlacePage | null => {
    const c = outline.chapters[chapterIndex]
    if (!c || page < 1 || page > c.pageCount) return null
    return {
      chapterIndex,
      chapterTitle: c.title,
      chapter: c.slug,
      page,
      href: chapterPageHref(slug, c.slug, page),
      label: pageLabel({ chapterIndex, page }),
      position: { chapter: c.slug, page },
    }
  }
  const indexOf = (chapter: string | null) => outline.chapters.findIndex((c) => c.slug === chapter)
  return {
    ref,
    title: outline.title,
    find: (position) => ('printedPage' in position ? null : pageOf(indexOf(position.chapter), position.page)),
    nearest: (chapter, page) => {
      const index = indexOf(chapter)
      if (index < 0) return pageOf(0, 1)
      return pageOf(index, page) ?? pageOf(index, 1)
    },
  }
}

function fromOutlines(outlines: ReadonlyMap<string, BookOutline>, slug: string, id: string): PlaceBook | null {
  const outline = outlines.get(id)
  return outline ? privateBook(slug, refFor(privateBookSlug(id)), outline) : null
}

export async function preloadBooks(db: Db, userId: number, slugs: readonly string[], cache: PlaceCache): Promise<void> {
  const ids = [...new Set(slugs)]
    .filter((slug) => !cache.has(slug))
    .map((slug) => [slug, refFor(slug).userBookId] as const)
    .filter((pair): pair is readonly [string, string] => pair[1] !== null)
  if (!ids.length) return
  const loading = loadOutlines(
    db,
    userId,
    ids.map(([, id]) => id),
  )
  for (const [slug, id] of ids) {
    cache.set(
      slug,
      loading.then((outlines) => fromOutlines(outlines, slug, id)),
    )
  }
  await loading
}

export function bookFor(db: Db, userId: number, slug: string, cache: PlaceCache): Promise<PlaceBook | null> {
  let found = cache.get(slug)
  if (!found) {
    const id = refFor(slug).userBookId
    found = id
      ? loadOutlines(db, userId, [id]).then((outlines) => fromOutlines(outlines, slug, id))
      : openTextBook(db, userId, slug).then(
          async (book) => book && catalogueBook(book.ref, book.title, await book.pages()),
        )
    cache.set(slug, found)
  }
  return found
}

export async function resolvePlace(
  db: Db,
  userId: number,
  slug: string,
  position: PagePosition,
  cache: PlaceCache,
): Promise<ResolvedPlace | null> {
  const book = await bookFor(db, userId, slug, cache)
  const page = book?.find(position)
  return book && page ? { ...page, ref: book.ref, bookTitle: book.title } : null
}

export async function placeForRead(
  db: Db,
  userId: number,
  slug: string,
  chapter: string | null,
  page: number,
  cache: PlaceCache,
): Promise<ResolvedPlace | null> {
  const book = await bookFor(db, userId, slug, cache)
  const found = book?.nearest(chapter, page)
  return book && found ? { ...found, ref: book.ref, bookTitle: book.title } : null
}

export async function resolveEpisode(
  db: Db,
  userId: number,
  slug: string,
  episodeId: string,
): Promise<{ durationMs: number } | null> {
  const audio = await (await openBook(db, userId, slug))?.audio()
  const episode = audio?.episodes.find((e) => e.id === episodeId)
  return episode ? { durationMs: episode.durationMs } : null
}
