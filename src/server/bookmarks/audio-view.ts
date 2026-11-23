import '@tanstack/react-start/server-only'
import { type AudioBookmarkView, inListeningOrder } from '~/shared/bookmarks/audio'
import type { AudioBook } from '~/shared/content/schema'
import { resolve } from '~/shared/highlights/anchor'
import type { BookPage } from '~/shared/highlights/page-text'
import type { AudioBookmarkRow } from './audio-store.ts'

export function toAudioBookmarkView(
  row: AudioBookmarkRow,
  pages: readonly BookPage[],
  audio: AudioBook | null,
): AudioBookmarkView {
  const createdAt = row.createdAt.toISOString()
  if (row.kind === 'episode') {
    const found = audio?.episodes.find((e) => e.id === row.episode)
    return {
      kind: 'episode',
      id: row.id,
      status: found ? 'ok' : 'missing',
      positionMs: row.positionMs,
      episode: found ? { id: found.id, number: found.number, title: found.title, durationMs: found.durationMs } : null,
      createdAt,
    }
  }
  const found = resolve(row, pages)
  const page = found.status === 'missing' ? undefined : pages[found.pageIndex]
  return {
    kind: 'voice',
    id: row.id,
    status: page && found.status !== 'missing' ? found.status : 'missing',
    opening: row.exact.replace(/\s+/g, ' ').trim(),
    place:
      page && found.status !== 'missing'
        ? {
            chapterIndex: page.chapterIndex,
            chapterTitle: page.chapterTitle,
            chapter: page.chapterSlug,
            page: page.page,
            pageHref: page.href,
            label: page.label,
            position: found.pageIndex,
            start: found.start,
          }
        : null,
    createdAt,
  }
}

export function toAudioBookmarkViews(
  rows: readonly AudioBookmarkRow[],
  pages: readonly BookPage[],
  audio: AudioBook | null,
): AudioBookmarkView[] {
  return inListeningOrder(rows.map((row) => toAudioBookmarkView(row, pages, audio)))
}
