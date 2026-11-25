import '@tanstack/react-start/server-only'
import { notFound } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import type { SpeechChapterData } from '~/shared/read-aloud/speech-text'
import { readerOf } from './auth.ts'
import { openTextBook } from './books/book.ts'

export function speechInput(data: { book?: unknown; chapter?: unknown }): { book: string; chapter: number } {
  const { book, chapter } = data
  if (typeof book !== 'string' || book.length === 0 || book.length > 200) throw new Error('Invalid book')
  if (typeof chapter !== 'number' || !Number.isInteger(chapter) || chapter < 0 || chapter > 100_000)
    throw new Error('Invalid chapter')
  return { book, chapter }
}

/** One chapter of a text book to read aloud, for whoever is signed in on this request; any other answer is a 404. */
export async function loadSpeechChapterData(slug: string, chapter: number): Promise<SpeechChapterData> {
  const { db, userId } = await readerOf(getRequest())
  const book = await openTextBook(db, userId, slug)
  const found = book ? await book.speechChapter(chapter) : null
  if (!found) throw notFound()
  return found
}
