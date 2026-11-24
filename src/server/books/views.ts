import '@tanstack/react-start/server-only'
import { privateBookSlug } from '~/shared/content/book-slug'
import { bookHref, catalogCoverImage, coverUrlFor } from '~/shared/content/library'
import {
  coverUrlOf,
  type PrivateCoverMeta,
  privateBookHref,
  privateCover,
  privateCoverImage,
  privateReaderContext,
} from '~/shared/content/private-book'
import type { ReaderContext } from '~/shared/content/reader-view'
import type { BookContent, BookMeta } from '~/shared/content/schema'
import type { SpeechBook } from '~/shared/read-aloud/speech-text'

/** A catalogue book as the read-aloud dock shows it. */
export function catalogueSpeechBook(meta: BookMeta, content: BookContent): SpeechBook {
  return {
    slug: meta.slug,
    title: meta.title,
    author: meta.author,
    href: bookHref(meta),
    coverUrl: coverUrlFor(meta),
    cover: meta.cover,
    image: catalogCoverImage(meta),
    language: meta.language,
    chapterTitles: content.chapters.map((c) => c.title),
  }
}

export interface PrivateDetails {
  title: string
  author: string
  language: string
  description: string | null
  cover: PrivateCoverMeta | null
}

/** A private book's reader context: its details, cover and chapter count. */
export function privateContext(bookId: string, book: PrivateDetails, chapterCount: number): ReaderContext {
  return privateReaderContext({
    id: bookId,
    title: book.title,
    author: book.author,
    language: book.language,
    chapterCount,
    description: book.description,
    cover: book.cover,
  })
}

/** A private book as the read-aloud dock shows it. */
export function privateSpeechBook(
  bookId: string,
  book: Omit<PrivateDetails, 'description'>,
  chapterTitles: string[],
): SpeechBook {
  const image = privateCoverImage(bookId, book.cover)
  return {
    slug: privateBookSlug(bookId),
    title: book.title,
    author: book.author,
    href: privateBookHref(bookId),
    coverUrl: coverUrlOf(image, book.title, book.author),
    cover: privateCover(book.title),
    image,
    language: book.language,
    chapterTitles,
  }
}
