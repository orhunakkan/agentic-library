import type { NewAudioBookmark } from '~/client/features/bookmarks/audio-bookmark-list'
import type { ReadAloudState, StartAt } from '~/client/features/read-aloud/controller'
import { formatClock, formatDuration } from '~/client/lib/format'
import type { AudioBookmarkView } from '~/shared/bookmarks/audio'
import type { PlayerBook, PlayerEpisode } from '~/shared/content/book-page'
import { fromStored, toStored } from '~/shared/content/position'
import type { SpeechBook } from '~/shared/read-aloud/speech-text'
import type { TransportState } from './transport'

export type NowPlaying =
  | { source: null }
  | {
      source: 'audiobook'
      book: PlayerBook
      episodes: PlayerEpisode[]
      episode: PlayerEpisode
      playing: boolean
      positionMs: number
    }
  | {
      source: 'read-aloud'
      book: SpeechBook
      engine: ReadAloudState['engine']
      chapter: ReadAloudState['chapter']
      page: ReadAloudState['page']
      utterance: ReadAloudState['utterance']
      playing: boolean
    }

export function nowPlaying(audiobook: TransportState, readAloud: ReadAloudState): NowPlaying {
  if (audiobook.book && audiobook.current) {
    const { book, episodes, current: episode, playing, positionMs } = audiobook
    return { source: 'audiobook', book, episodes, episode, playing, positionMs }
  }
  if (readAloud.book) {
    const { book, engine, chapter, page, utterance } = readAloud
    return { source: 'read-aloud', book, engine, chapter, page, utterance, playing: readAloud.status === 'playing' }
  }
  return { source: null }
}

export function momentOf(now: NowPlaying): NewAudioBookmark | null {
  if (now.source === 'read-aloud') {
    const { book, chapter, page } = now
    if (!chapter || !page) return null
    const { position } = page
    const offset = now.utterance?.start ?? 0
    return {
      request: { book: book.slug, kind: 'voice', position, offset },
      view: {
        kind: 'voice',
        opening: '',
        place: {
          chapterIndex: chapter.index,
          chapterTitle: chapter.title,
          ...toStored(position),
          pageHref: page.href,
          label: page.label,
          position: 0,
          start: offset,
        },
      },
      label: page.label,
    }
  }
  if (now.source === 'audiobook') {
    const positionMs = Math.floor(now.positionMs / 1000) * 1000
    const { id, number, title, durationMs } = now.episode
    return {
      request: { book: now.book.slug, kind: 'episode', episode: id, positionMs },
      view: { kind: 'episode', positionMs, episode: { id, number, title, durationMs } },
      label: formatClock(positionMs),
    }
  }
  return null
}

export function partsOf(now: NowPlaying): { items: { value: string; label: string }[]; current: string | null } {
  if (now.source === 'read-aloud')
    return {
      items: now.book.chapterTitles.map((title, i) => ({ value: String(i), label: `${i + 1}. ${title}` })),
      current: now.chapter ? String(now.chapter.index) : null,
    }
  if (now.source === 'audiobook')
    return {
      items: now.episodes.map((e) => ({
        value: e.id,
        label: `${e.number}. ${e.title} · ${formatDuration(e.durationMs)}`,
      })),
      current: now.episode.id,
    }
  return { items: [], current: null }
}

/** The kind an audio bookmark is stored under, which keeps its older names. */
export const bookmarkKind = (now: NowPlaying): 'voice' | 'episode' | null =>
  now.source === 'read-aloud' ? 'voice' : now.source === 'audiobook' ? 'episode' : null

export function bookmarkPlay(
  now: NowPlaying,
  item: AudioBookmarkView,
):
  | { source: 'read-aloud'; book: string; at: StartAt }
  | { source: 'audiobook'; episodeId: string; positionMs: number }
  | null {
  if (item.kind === 'voice' && item.place && now.source === 'read-aloud') {
    const { chapterIndex, chapter, page, start } = item.place
    const position = fromStored(chapter, page)
    return {
      source: 'read-aloud',
      book: now.book.slug,
      at: { kind: 'offset', chapter: chapterIndex, position, offset: start },
    }
  }
  if (item.kind === 'episode' && item.episode && now.source === 'audiobook')
    return { source: 'audiobook', episodeId: item.episode.id, positionMs: item.positionMs }
  return null
}
