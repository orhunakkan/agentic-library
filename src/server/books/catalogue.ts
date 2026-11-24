import '@tanstack/react-start/server-only'
import { bookAudio } from '~/shared/content/book-page'
import { bookHref } from '~/shared/content/library'
import { buildReaderView } from '~/shared/content/reader-view'
import type { BookContent, BookMeta } from '~/shared/content/schema'
import { type BookPage, bookPages } from '~/shared/highlights/page-text'
import { speechChapter } from '~/shared/read-aloud/speech-text'
import { catalogueVersion } from '../downloads/version.ts'
import { loadAudio, loadCatalog } from '../repository.ts'
import type { BuiltTextBook } from './book.ts'
import { catalogueOfflineBook } from './offline.ts'
import { catalogueSpeechBook } from './views.ts'

const cataloguePages = new WeakMap<BookContent, readonly BookPage[]>()

/** A catalogue book's page texts, built once per content and shared by every reader. */
function sharedPages(content: BookContent): readonly BookPage[] {
  let pages = cataloguePages.get(content)
  if (!pages) {
    pages = bookPages(content)
    cataloguePages.set(content, pages)
  }
  return pages
}

/** A catalogue book, the same for everyone, over its content from the repository cache. */
export function openCatalogueBook(meta: BookMeta, loaded: BookContent): BuiltTextBook {
  const content = async () => loaded
  const audio = () => loadAudio(meta.slug)
  return {
    slug: meta.slug,
    ref: { slug: meta.slug, userBookId: null },
    title: meta.title,
    author: meta.author,
    language: meta.language,
    href: bookHref(meta),
    format: 'text',
    audio,
    content,
    pages: async () => sharedPages(loaded),
    readerPage: async (part, n) => {
      const [catalog, recorded, offlineVersion] = await Promise.all([
        loadCatalog(),
        audio(),
        catalogueVersion(meta.slug),
      ])
      const view = buildReaderView({ meta, catalog }, loaded, part, n)
      return (
        view && {
          view,
          cover: meta.cover,
          audio: recorded ? bookAudio(meta, loaded, recorded) : null,
          offlineVersion: offlineVersion ?? '',
        }
      )
    },
    offlineCopy: () => catalogueOfflineBook(meta.slug),
    speechChapter: async (index) => {
      const chapter = speechChapter(loaded, index)
      return chapter && { book: catalogueSpeechBook(meta, loaded), chapter }
    },
  }
}
