import '@tanstack/react-start/server-only'
import { MAX_AUDIO_BOOKMARKS_PER_BOOK, MAX_AUDIO_BOOKMARKS_PER_USER } from '~/shared/bookmarks/audio'
import { isUuid } from '../../shared/uuid.ts'
import { onBook, ownsBook } from '../books/book.ts'
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

export function createAudioBookmark(
  pool: Pool,
  userId: number,
  book: BookRef,
  moment: NewAudioBookmark,
): Promise<AudioCreateResult> {
  return pool.begin(async (tx): Promise<AudioCreateResult> => {
    await tx`select id from users where id = ${userId} for update`
    if (!(await ownsBook(tx, userId, book))) return 'missing'
    const same =
      moment.kind === 'voice'
        ? tx`kind = 'voice' and chapter is not distinct from ${moment.chapter} and page = ${moment.page}
            and start_offset = ${moment.start}`
        : tx`kind = 'episode' and episode = ${moment.episode} and position_ms = ${moment.positionMs}`
    const existing = async () => {
      const [found] = await tx<Raw[]>`
        select ${tx.unsafe(COLUMNS)} from audio_bookmarks
        where user_id = ${userId} and ${onBook(tx, book)} and ${same}`
      return found ? { row: toRow(found), created: false } : null
    }
    const already = await existing()
    if (already) return already
    const [counts] = await tx<{ in_book: string; in_all: string }[]>`
      select count(*) filter (where ${onBook(tx, book)}) as in_book, count(*) as in_all
      from audio_bookmarks where user_id = ${userId}`
    if (Number(counts?.in_book ?? 0) >= MAX_AUDIO_BOOKMARKS_PER_BOOK) return 'quota-book'
    if (Number(counts?.in_all ?? 0) >= MAX_AUDIO_BOOKMARKS_PER_USER) return 'quota-user'
    const [created] =
      moment.kind === 'voice'
        ? await tx<Raw[]>`
            insert into audio_bookmarks
              (user_id, book_slug, user_book_id, kind, chapter, page, start_offset, end_offset, exact, prefix, suffix)
            values (${userId}, ${book.slug}, ${book.userBookId}, 'voice', ${moment.chapter}, ${moment.page},
              ${moment.start}, ${moment.end}, ${moment.exact}, ${moment.prefix}, ${moment.suffix})
            on conflict do nothing
            returning ${tx.unsafe(COLUMNS)}`
        : await tx<Raw[]>`
            insert into audio_bookmarks (user_id, book_slug, user_book_id, kind, episode, position_ms)
            values (${userId}, ${book.slug}, ${book.userBookId}, 'episode', ${moment.episode}, ${moment.positionMs})
            on conflict do nothing
            returning ${tx.unsafe(COLUMNS)}`
    if (created) return { row: toRow(created), created: true }
    const raced = await existing()
    if (!raced) throw new Error('insert returned no row')
    return raced
  })
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
