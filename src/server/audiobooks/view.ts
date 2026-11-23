import '@tanstack/react-start/server-only'
import type { AudioBook, AudioEpisode } from '../../shared/content/schema.ts'
import type { Db } from '../db.ts'
import { type AudiobookChapterRow, audiobookChapters } from './store.ts'

export const audioFileHref = (bookId: string, n: number) => `/account/books/${bookId}/audio/${n}`

export function audioEpisodes(bookId: string, chapters: readonly AudiobookChapterRow[]): AudioEpisode[] {
  return chapters.map((c) => ({
    id: String(c.position),
    slug: `chapter-${c.position}`,
    title: c.title,
    number: c.position,
    durationMs: c.durationMs,
    audioUrl: audioFileHref(bookId, c.fileN),
  }))
}

export async function audiobookAudio(db: Db, userId: number, bookId: string): Promise<AudioBook | null> {
  const chapters = await audiobookChapters(db, userId, bookId)
  if (!chapters.length) return null
  return { bookSlug: `u-${bookId}`, credit: '', sourceUrl: '', episodes: audioEpisodes(bookId, chapters) }
}
