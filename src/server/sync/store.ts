import '@tanstack/react-start/server-only'
import { onBook, onBookConflict, ownedBook } from '../books/book.ts'
import { type BookRef, bookOf } from '../books/ref.ts'
import type { Db, Pool } from '../db.ts'

export interface ReadingItem {
  ref: BookRef
  chapter: string | null
  page: number
  at: number
}

export type ListeningItem =
  | { ref: BookRef; kind: 'episode'; episode: string; positionMs: number | null; at: number }
  | {
      ref: BookRef
      kind: 'voice'
      place: { chapterIndex: number; chapter: string | null; page: number; offset: number } | null
      at: number
    }

export interface SettingsItem {
  values: object
  at: number
}

export interface SyncItems {
  reading: ReadingItem[]
  listening: ListeningItem[]
  settings: SettingsItem | null
}

export async function saveBatch(pool: Pool, userId: number, device: string, items: SyncItems): Promise<void> {
  await pool.begin(async (tx) => {
    for (const { ref, chapter, page, at } of items.reading) {
      await tx`
        insert into reading_places (user_id, book_slug, user_book_id, chapter, page, at, device)
        select ${userId}::bigint, ${ref.slug}::text, ${ref.userBookId}::uuid, ${chapter}::text, ${page}::int,
          ${new Date(at)}::timestamptz, ${device}::text
        where ${ownedBook(tx, userId, ref)}
        on conflict ${onBookConflict(tx, ref)}
        do update set chapter = excluded.chapter, page = excluded.page, at = excluded.at, device = excluded.device
        where reading_places.at < excluded.at`
    }
    for (const listeningItem of items.listening) {
      if (listeningItem.kind === 'episode') {
        const { ref, episode, positionMs, at } = listeningItem
        await tx`
          insert into listening_places (user_id, book_slug, user_book_id, kind, episode, position_ms, at, device)
          select ${userId}::bigint, ${ref.slug}::text, ${ref.userBookId}::uuid, 'episode', ${episode}::text,
            ${positionMs}::int, ${new Date(at)}::timestamptz, ${device}::text
          where ${ownedBook(tx, userId, ref)}
          on conflict ${onBookConflict(tx, ref, { keys: ['episode'], where: tx`kind = 'episode'` })}
          do update set position_ms = excluded.position_ms, at = excluded.at, device = excluded.device
          where listening_places.at < excluded.at`
        continue
      }
      const { ref, place, at } = listeningItem
      await tx`
        insert into listening_places
          (user_id, book_slug, user_book_id, kind, chapter_index, chapter, page, start_offset, at, device)
        select ${userId}::bigint, ${ref.slug}::text, ${ref.userBookId}::uuid, 'voice', ${place?.chapterIndex ?? null}::int,
          ${place?.chapter ?? null}::text, ${place?.page ?? null}::int, ${place?.offset ?? null}::int, ${new Date(at)}::timestamptz,
          ${device}::text
        where ${ownedBook(tx, userId, ref)}
        on conflict ${onBookConflict(tx, ref, { where: tx`kind = 'voice'` })}
        do update set chapter_index = excluded.chapter_index, chapter = excluded.chapter, page = excluded.page,
          start_offset = excluded.start_offset, at = excluded.at, device = excluded.device
        where listening_places.at < excluded.at`
    }
    const settingsItem = items.settings
    if (settingsItem) {
      await tx`
        insert into reader_settings (user_id, settings, at, device)
        values (${userId}, ${tx.json(settingsItem.values as never)}, ${new Date(settingsItem.at)}, ${device})
        on conflict (user_id)
        do update set settings = excluded.settings, at = excluded.at, device = excluded.device
        where reader_settings.at < excluded.at`
    }
  })
}

export interface ReadingRow {
  ref: BookRef
  chapter: string | null
  page: number
  at: Date
  device: string
}

export type ListeningRow =
  | { ref: BookRef; kind: 'episode'; episode: string; positionMs: number | null; at: Date; device: string }
  | {
      ref: BookRef
      kind: 'voice'
      chapterIndex: number | null
      chapter: string | null
      page: number | null
      offset: number | null
      at: Date
      device: string
    }

interface RawReading {
  book_slug: string | null
  user_book_id: string | null
  chapter: string | null
  page: number
  at: Date
  device: string
}

const toReading = (rawReading: RawReading): ReadingRow => ({
  ref: bookOf(rawReading),
  chapter: rawReading.chapter,
  page: rawReading.page,
  at: rawReading.at,
  device: rawReading.device,
})

export async function listReading(db: Db, userId: number, limit: number): Promise<ReadingRow[]> {
  const rows = await db<RawReading[]>`
    select book_slug, user_book_id, chapter, page, at, device from reading_places
    where user_id = ${userId}
    order by at desc, id
    limit ${limit}`
  return rows.map(toReading)
}

export async function readingFor(db: Db, userId: number, ref: BookRef): Promise<ReadingRow | null> {
  const [row] = await db<RawReading[]>`
    select book_slug, user_book_id, chapter, page, at, device from reading_places
    where user_id = ${userId} and ${onBook(db, ref)}`
  return row ? toReading(row) : null
}

export async function listListening(db: Db, userId: number, limit: number): Promise<ListeningRow[]> {
  const rows = await db<
    {
      book_slug: string | null
      user_book_id: string | null
      kind: 'episode' | 'voice'
      episode: string | null
      position_ms: number | null
      chapter_index: number | null
      chapter: string | null
      page: number | null
      start_offset: number | null
      at: Date
      device: string
    }[]
  >`
    select book_slug, user_book_id, kind, episode, position_ms, chapter_index, chapter, page, start_offset, at, device
    from listening_places
    where user_id = ${userId}
    order by at desc, id
    limit ${limit}`
  return rows.map((rawListening): ListeningRow => {
    const common = { ref: bookOf(rawListening), at: rawListening.at, device: rawListening.device }
    return rawListening.kind === 'episode'
      ? { ...common, kind: 'episode', episode: rawListening.episode ?? '', positionMs: rawListening.position_ms }
      : {
          ...common,
          kind: 'voice',
          chapterIndex: rawListening.chapter_index,
          chapter: rawListening.chapter,
          page: rawListening.page,
          offset: rawListening.start_offset,
        }
  })
}

export async function getSettings(
  db: Db,
  userId: number,
): Promise<{ settings: unknown; at: Date; device: string } | null> {
  const [row] = await db<{ settings: unknown; at: Date; device: string }[]>`
    select settings, at, device from reader_settings where user_id = ${userId}`
  return row ?? null
}
