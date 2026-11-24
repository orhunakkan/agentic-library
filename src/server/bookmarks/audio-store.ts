import '@tanstack/react-start/server-only'
import { MAX_AUDIO_BOOKMARKS_PER_BOOK, MAX_AUDIO_BOOKMARKS_PER_USER } from '~/shared/bookmarks/audio'
import { isUuid } from '../../shared/uuid.ts'
import { insertCapped, onBook } from '../books/book.ts'
import type { BookRef } from '../books/ref.ts'
import type { Db, Pool } from '../db.ts'

export interface VoiceMoment {
  kind: 'voice'
  chapter: string | null
  page: number
  start: number
  end: number
  exact: string
  prefix: string
  suffix: string
}

export interface EpisodeMoment {
  kind: 'episode'
  episode: string
  positionMs: number
}

export type NewAudioBookmark = VoiceMoment | EpisodeMoment

export type AudioBookmarkRow = NewAudioBookmark & { id: string; createdAt: Date }

interface Raw {
  id: string
  kind: 'voice' | 'episode'
  episode: string | null
  position_ms: number | null
  chapter: string | null
  page: number | null
  start_offset: number | null
  end_offset: number | null
  exact: string | null
  prefix: string | null
  suffix: string | null
  created_at: Date
}

const COLUMNS =
  'id, kind, episode, position_ms, chapter, page, start_offset, end_offset, exact, prefix, suffix, created_at'

function toRow(r: Raw): AudioBookmarkRow {
  if (r.kind === 'episode')
    return {
      id: r.id,
      kind: 'episode',
      episode: r.episode ?? '',
      positionMs: r.position_ms ?? 0,
      createdAt: r.created_at,
    }
  return {
    id: r.id,
    kind: 'voice',
    chapter: r.chapter,
    page: r.page ?? 1,
    start: r.start_offset ?? 0,
    end: r.end_offset ?? 0,
    exact: r.exact ?? '',
    prefix: r.prefix ?? '',
    suffix: r.suffix ?? '',
    createdAt: r.created_at,
  }
}

export type AudioCreateResult = { row: AudioBookmarkRow; created: boolean } | 'missing' | 'quota-book' | 'quota-user'

export async function createAudioBookmark(
  pool: Pool,
  userId: number,
  book: BookRef,
  moment: NewAudioBookmark,
): Promise<AudioCreateResult> {
  const result = await insertCapped<Raw>(pool, userId, book, {
    table: 'audio_bookmarks',
    limits: { perBook: MAX_AUDIO_BOOKMARKS_PER_BOOK, perUser: MAX_AUDIO_BOOKMARKS_PER_USER },
    returning: COLUMNS,
    ...(moment.kind === 'voice'
      ? {
          values: {
            kind: 'voice',
            chapter: moment.chapter,
            page: moment.page,
            start_offset: moment.start,
            end_offset: moment.end,
            exact: moment.exact,
            prefix: moment.prefix,
            suffix: moment.suffix,
          },
          same: { kind: 'voice', chapter: moment.chapter, page: moment.page, start_offset: moment.start },
        }
      : {
          values: { kind: 'episode', episode: moment.episode, position_ms: moment.positionMs },
          same: { kind: 'episode', episode: moment.episode, position_ms: moment.positionMs },
        }),
  })
  return typeof result === 'string' ? result : { row: toRow(result.row), created: result.created }
}

export async function listAudioForBook(db: Db, userId: number, book: BookRef): Promise<AudioBookmarkRow[]> {
  const rows = await db<Raw[]>`
    select ${db.unsafe(COLUMNS)} from audio_bookmarks
    where user_id = ${userId} and ${onBook(db, book)}
    order by created_at, id`
  return rows.map(toRow)
}

export async function deleteAudioBookmark(db: Db, userId: number, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const result = await db`delete from audio_bookmarks where id = ${id} and user_id = ${userId}`
  return result.count > 0
}
