import type { AudioBookmarkView } from '~/shared/bookmarks/audio'
import type { PagePosition } from '~/shared/highlights/page-text'
import { type BookmarkResult, createdOf, deletedOf, send } from './bookmarks-client'

export type AudioBookmarkRequest =
  | { book: string; kind: 'voice'; position: PagePosition; offset: number }
  | { book: string; kind: 'episode'; episode: string; positionMs: number }

export function createAudioBookmark(
  request: AudioBookmarkRequest,
): Promise<BookmarkResult<{ bookmark: AudioBookmarkView; created: boolean }>> {
  return send('/account/bookmarks/audio/new', request, createdOf<AudioBookmarkView>)
}

export function deleteAudioBookmark(id: string): Promise<BookmarkResult<true>> {
  return send(`/account/bookmarks/audio/${encodeURIComponent(id)}`, { intent: 'delete' }, deletedOf)
}
