import '@tanstack/react-start/server-only'
import { MAX_AUDIO_BOOKMARKS_PER_BOOK, MAX_AUDIO_BOOKMARKS_PER_USER } from '~/shared/bookmarks/audio'
import { isUuid } from '../../shared/uuid.ts'
import { type Capped, type CappedRaw, insertCapped, onBook } from '../books/book.ts'
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

const COLUMNS = [
  'id',
  'kind',
  'episode',
  'position_ms',
  'chapter',
  'page',
  'start_offset',
  'end_offset',
  'exact',
  'prefix',
  'suffix',
  'created_at',
] as const

type Raw = CappedRaw<'audio_bookmarks', (typeof COLUMNS)[number]>

function toRow(bookmark: Raw): AudioBookmarkRow {
  if (bookmark.kind === 'episode')
    return {
      id: bookmark.id,
      kind: 'episode',
      episode: bookmark.episode ?? '',
      positionMs: bookmark.position_ms ?? 0,
      createdAt: bookmark.created_at,
    }
  return {
    id: bookmark.id,
    kind: 'voice',
    chapter: bookmark.chapter,
    page: bookmark.page ?? 1,
    start: bookmark.start_offset ?? 0,
    end: bookmark.end_offset ?? 0,
    exact: bookmark.exact ?? '',
    prefix: bookmark.prefix ?? '',
    suffix: bookmark.suffix ?? '',
    createdAt: bookmark.created_at,
  }
}

export type AudioCreateResult = Capped<AudioBookmarkRow>

export function createAudioBookmark(
  pool: Pool,
  userId: number,
  book: BookRef,
  moment: NewAudioBookmark,
): Promise<AudioCreateResult> {
  const table = 'audio_bookmarks'
  const limits = { perBook: MAX_AUDIO_BOOKMARKS_PER_BOOK, perUser: MAX_AUDIO_BOOKMARKS_PER_USER }
  if (moment.kind === 'episode')
    return insertCapped(pool, userId, book, {
      table,
      limits,
      values: { kind: 'episode', episode: moment.episode, position_ms: moment.positionMs },
      returning: COLUMNS,
      same: ['kind', 'episode', 'position_ms'],
      toRow,
    })
  return insertCapped(pool, userId, book, {
    table,
    limits,
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
    returning: COLUMNS,
    same: ['kind', 'chapter', 'page', 'start_offset'],
    toRow,
  })
}

export async function listAudioForBook(db: Db, userId: number, book: BookRef): Promise<AudioBookmarkRow[]> {
  const rows = await db<Raw[]>`
    select ${db(COLUMNS)} from audio_bookmarks
    where user_id = ${userId} and ${onBook(db, book)}
    order by created_at, id`
  return rows.map(toRow)
}

export async function deleteAudioBookmark(db: Db, userId: number, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const result = await db`delete from audio_bookmarks where id = ${id} and user_id = ${userId}`
  return result.count > 0
}
