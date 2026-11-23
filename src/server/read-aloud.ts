import '@tanstack/react-start/server-only'
import { notFound } from '@tanstack/react-router'
import { bookHref, catalogCoverImage, coverUrlFor } from '~/shared/content/library'
import { privateBookId } from '~/shared/content/private-book'
import type { BookContent, BookMeta } from '~/shared/content/schema'
import { type SpeechBook, type SpeechChapterData, speechChapter } from '~/shared/read-aloud/speech-text'
import { privateSpeechChapter } from './private-reading.ts'
import { catalogueBook, loadBook } from './repository.ts'

export function speechInput(data: { book?: unknown; chapter?: unknown }): { book: string; chapter: number } {
  const { book, chapter } = data
  if (typeof book !== 'string' || book.length === 0 || book.length > 200) throw new Error('Invalid book')
  if (typeof chapter !== 'number' || !Number.isInteger(chapter) || chapter < 0 || chapter > 100_000)
    throw new Error('Invalid chapter')
  return { book, chapter }
}

export async function loadSpeechChapterData(book: string, chapter: number): Promise<SpeechChapterData> {
  if (privateBookId(book)) return privateSpeechChapter(book, chapter)
  const [meta, content] = await Promise.all([catalogueBook(book), loadBook(book)])
  const found = meta && content ? speechChapter(content, chapter) : null
  if (!meta || !content || !found) throw notFound()
  return { book: catalogueSpeechBook(meta, content), chapter: found }
}

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
