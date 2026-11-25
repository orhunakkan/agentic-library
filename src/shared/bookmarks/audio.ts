import { type BookmarkPlace, type BookmarkView, byAge, openingAt, type PageAnchor } from './bookmarks.ts'

export const MAX_AUDIO_BOOKMARKS_PER_BOOK = 1_000
export const MAX_AUDIO_BOOKMARKS_PER_USER = 10_000

export interface VoicePlace extends BookmarkPlace {
  start: number
}

export interface EpisodeRef {
  id: string
  number: number
  title: string
  durationMs: number
}

export type AudioBookmarkView =
  | {
      kind: 'voice'
      id: string
      status: 'ok' | 'moved' | 'missing'
      opening: string
      place: VoicePlace | null
      createdAt: string
    }
  | {
      kind: 'episode'
      id: string
      status: 'ok' | 'missing'
      positionMs: number
      episode: EpisodeRef | null
      createdAt: string
    }

export type VoiceBookmarkView = Extract<AudioBookmarkView, { kind: 'voice' }>
export type EpisodeBookmarkView = Extract<AudioBookmarkView, { kind: 'episode' }>

export type TabEntry = { kind: 'page'; bookmark: BookmarkView } | { kind: 'voice'; bookmark: VoiceBookmarkView }

export function momentAnchor(text: string, offset: number): PageAnchor | null {
  return openingAt(text, offset)
}

type SortKey = [number, number, number]

function byKey(ka: SortKey | null, kb: SortKey | null, age: number): number {
  if (ka && kb) return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || age
  if (ka || kb) return ka ? -1 : 1
  return age
}

function key(b: AudioBookmarkView): SortKey | null {
  if (b.kind === 'voice') return b.place ? [0, b.place.position, b.place.start] : null
  return b.episode ? [1, b.episode.number, b.positionMs] : null
}

export function inListeningOrder<T extends AudioBookmarkView>(bookmarks: readonly T[]): T[] {
  return [...bookmarks].sort((a, b) => byKey(key(a), key(b), byAge(a, b)))
}

export function tabOrder(pages: readonly BookmarkView[], voices: readonly AudioBookmarkView[]): TabEntry[] {
  const entries: TabEntry[] = [
    ...pages.map((bookmark): TabEntry => ({ kind: 'page', bookmark })),
    ...voices.flatMap((b): TabEntry[] => (b.kind === 'voice' ? [{ kind: 'voice', bookmark: b }] : [])),
  ]
  const at = (e: TabEntry): SortKey | null => {
    const place = e.bookmark.place
    if (!place) return null
    return e.kind === 'page' ? [place.position, 0, 0] : [place.position, 1, (place as VoicePlace).start]
  }
  return entries.sort((a, b) => byKey(at(a), at(b), byAge(a.bookmark, b.bookmark)))
}
