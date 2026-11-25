import '@tanstack/react-start/server-only'
import { privateBookSlug } from '../../shared/content/book-slug.ts'
import type { AudioBook, AudioEpisode } from '../../shared/content/schema.ts'
import type { Db } from '../db.ts'
import { type AudiobookChapterRow, audiobookChapters } from './store.ts'

export const audioFileHref = (bookId: string, n: number) => `/account/books/${bookId}/audio/${n}`

export function audioEpisodes(bookId: string, chapters: readonly AudiobookChapterRow[]): AudioEpisode[] {
  return chapters.map((chapter) => ({
    id: String(chapter.position),
    slug: `chapter-${chapter.position}`,
    title: chapter.title,
    number: chapter.position,
    durationMs: chapter.durationMs,
    audioUrl: audioFileHref(bookId, chapter.fileN),
  }))
}

export async function audiobookAudio(db: Db, userId: number, bookId: string): Promise<AudioBook | null> {
  const chapters = await audiobookChapters(db, userId, bookId)
  if (!chapters.length) return null
  return { bookSlug: privateBookSlug(bookId), credit: '', sourceUrl: '', episodes: audioEpisodes(bookId, chapters) }
}
