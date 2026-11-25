import '@tanstack/react-start/server-only'
import type { AudioChapter } from '../../shared/audiobooks/chapters.ts'
import type { AudiobookStart } from '../../shared/audiobooks/input.ts'
import { AUDIO_MEDIA_TYPE, type AudioFileType, MAX_USER_AUDIO_BYTES } from '../../shared/audiobooks/limits.ts'
import type { PrivateCoverMeta } from '../../shared/content/private-book.ts'
import type { BookDetails } from '../../shared/import/details.ts'
import { MAX_BOOKS } from '../../shared/import/limits.ts'
import { recordEvent } from '../audit.ts'
import { type CoverColumns, coverMetaOf } from '../book-details/store.ts'
import type { Db, Pool } from '../db.ts'
import { retryAtLocked } from '../quota.ts'
import { IMPORT_LIMIT } from '../rate-limit.ts'
import { COVER_COLUMNS, countedBooks, type DetailColumns, detailsOf, sweepStaleUploads } from '../user-books.ts'

export type MediaType = 'audio/mp4' | 'audio/mpeg'

export const typeOfMedia = (media: MediaType): AudioFileType => (media === 'audio/mp4' ? 'mp4' : 'mp3')

export type StartQuota = 'books' | 'audio' | 'rate'

export type StartResult = { ok: true; id: string } | { ok: false; quota: StartQuota; max: number }

export async function audioBytesUsed(db: Db, userId: number): Promise<number> {
  const [row] = await db<{ bytes: string }[]>`
    select coalesce(sum(audio_bytes), 0) as bytes from user_books where user_id = ${userId} and format = 'audio'`
  return Number(row?.bytes ?? 0)
}

export function startAudiobook(
  pool: Pool,
  userId: number,
  book: AudiobookStart,
  now = new Date(),
  maxBooks = MAX_BOOKS,
): Promise<StartResult> {
  const bytes = book.files.reduce((n, b) => n + b, 0)
  return pool.begin(async (tx): Promise<StartResult> => {
    await tx`select id from users where id = ${userId} for update`
    await sweepStaleUploads(tx, userId)
    if (await retryAtLocked(tx, userId, 'import', now)) return { ok: false, quota: 'rate', max: IMPORT_LIMIT.max }
    if ((await countedBooks(tx, userId)) >= maxBooks) return { ok: false, quota: 'books', max: maxBooks }
    if ((await audioBytesUsed(tx, userId)) + bytes > MAX_USER_AUDIO_BYTES)
      return { ok: false, quota: 'audio', max: MAX_USER_AUDIO_BYTES }
    const { details } = book
    const [row] = await tx<{ id: string }[]>`
      insert into user_books
        (user_id, title, author, language, chapter_count, description, isbn, publisher, published_year,
          format, narrator, audio_ms, audio_bytes)
      values (${userId}, ${book.title}, ${book.author}, ${book.language}, ${book.chapters.length},
        ${details.description}, ${details.isbn}, ${details.publisher}, ${details.publishedYear},
        'audio', ${book.narrator}, ${book.chapters.reduce((n, c) => n + c.durationMs, 0)}, ${bytes})
      returning id`
    if (!row) throw new Error('insert returned no row')
    const media = AUDIO_MEDIA_TYPE[book.type]
    await tx`
      insert into user_book_audio_files (book_id, n, media_type, bytes)
      select ${row.id}, n, ${media}, b from unnest(${book.files}::bigint[]) with ordinality as f (b, n)`
    await tx`
      insert into user_book_audio_chapters (book_id, position, title, file_n, start_ms, duration_ms)
      select ${row.id}, p, t, f, s, d
      from unnest(${book.chapters.map((c) => c.title)}::text[], ${book.chapters.map((c) => c.fileN)}::int[],
        ${book.chapters.map((c) => c.startMs)}::int[], ${book.chapters.map((c) => c.durationMs)}::int[])
        with ordinality as c (t, f, s, d, p)`
    return { ok: true, id: row.id }
  })
}

export async function userBookIds(db: Db, userId: number): Promise<Set<string>> {
  const rows = await db<{ id: string }[]>`select id from user_books where user_id = ${userId}`
  return new Set(rows.map((r) => r.id))
}

export interface UploadingFile {
  mediaType: MediaType
  bytes: number
  received: number
}

export async function uploadingFile(
  db: Db,
  userId: number,
  bookId: string,
  fileNumber: number,
): Promise<UploadingFile | null> {
  const [row] = await db<{ media_type: MediaType; bytes: string; received: string }[]>`
    select f.media_type, f.bytes, f.received
    from user_book_audio_files f join user_books b on b.id = f.book_id
    where f.book_id = ${bookId} and f.n = ${fileNumber} and b.user_id = ${userId} and b.status = 'uploading'
      and b.format = 'audio'`
  return row ? { mediaType: row.media_type, bytes: Number(row.bytes), received: Number(row.received) } : null
}

export async function recordChunk(
  db: Db,
  userId: number,
  bookId: string,
  fileNumber: number,
  offset: number,
  length: number,
): Promise<number | null> {
  const [row] = await db<{ received: string }[]>`
    update user_book_audio_files f set received = f.received + ${length}
    from user_books b
    where f.book_id = ${bookId} and f.n = ${fileNumber} and b.id = f.book_id and b.user_id = ${userId}
      and b.status = 'uploading' and f.received = ${offset} and f.received + ${length} <= f.bytes
    returning f.received`
  return row ? Number(row.received) : null
}

export interface FinishingBook {
  files: { n: number; mediaType: MediaType; bytes: number; received: number }[]
  chapters: AudioChapter[]
}

export async function finishingBook(db: Db, userId: number, bookId: string): Promise<FinishingBook | null> {
  const [book] = await db`
    select 1 from user_books where id = ${bookId} and user_id = ${userId} and status = 'uploading' and format = 'audio'`
  if (!book) return null
  const [files, chapters] = await Promise.all([
    db<{ n: number; media_type: MediaType; bytes: string; received: string }[]>`
      select n, media_type, bytes, received from user_book_audio_files where book_id = ${bookId} order by n`,
    db<{ title: string; file_n: number; start_ms: number; duration_ms: number }[]>`
      select title, file_n, start_ms, duration_ms from user_book_audio_chapters where book_id = ${bookId}
      order by position`,
  ])
  return {
    files: files.map((file) => ({
      n: file.n,
      mediaType: file.media_type,
      bytes: Number(file.bytes),
      received: Number(file.received),
    })),
    chapters: chapters.map((chapter) => ({
      title: chapter.title,
      fileN: chapter.file_n,
      startMs: chapter.start_ms,
      durationMs: chapter.duration_ms,
    })),
  }
}

export function finishAudiobook(
  pool: Pool,
  userId: number,
  bookId: string,
  read: { durations: number[]; chapters: AudioChapter[] },
  ip: string | null,
): Promise<boolean> {
  return pool.begin(async (tx): Promise<boolean> => {
    const [book] = await tx<{ audio_bytes: string }[]>`
      select audio_bytes from user_books
      where id = ${bookId} and user_id = ${userId} and status = 'uploading' and format = 'audio'
      for update`
    if (!book) return false
    await tx`
      update user_book_audio_files f set duration_ms = d.ms
      from unnest(${read.durations}::int[]) with ordinality as d (ms, n)
      where f.book_id = ${bookId} and f.n = d.n`
    await tx`
      update user_book_audio_chapters c set duration_ms = d.ms
      from unnest(${read.chapters.map((c) => c.durationMs)}::int[]) with ordinality as d (ms, p)
      where c.book_id = ${bookId} and c.position = d.p and c.duration_ms <> d.ms`
    const ms = read.chapters.reduce((n, c) => n + c.durationMs, 0)
    await tx`update user_books set status = 'ready', ready_at = now(), audio_ms = ${ms} where id = ${bookId}`
    await recordEvent(tx, 'book.imported', {
      userId,
      ip,
      detail: { bookId, format: 'audio', files: read.durations.length, bytes: Number(book.audio_bytes), ms },
    })
    return true
  })
}

export interface AudiobookChapterRow {
  position: number
  title: string
  fileN: number
  startMs: number
  durationMs: number
}

export interface AudiobookPageData {
  id: string
  title: string
  author: string
  narrator: string | null
  language: string
  details: BookDetails
  openLibraryWork: string | null
  cover: PrivateCoverMeta | null
  readyAt: Date
  audioMs: number
  audioBytes: number
  type: AudioFileType
  fileCount: number
  chapters: AudiobookChapterRow[]
}

export async function loadAudiobook(db: Db, userId: number, bookId: string): Promise<AudiobookPageData | null> {
  const [book] = await db<
    ({
      title: string
      author: string
      narrator: string | null
      language: string
      ready_at: Date
      open_library_work: string | null
      audio_ms: string
      audio_bytes: string
      media_type: MediaType
      file_count: number
    } & DetailColumns &
      CoverColumns)[]
  >`
    select b.title, b.author, b.narrator, b.language, b.ready_at, b.open_library_work, b.description, b.isbn,
      b.publisher, b.published_year, b.audio_ms, b.audio_bytes, ${db.unsafe(COVER_COLUMNS)},
      (select f.media_type from user_book_audio_files f where f.book_id = b.id and f.n = 1) as media_type,
      (select count(*)::int from user_book_audio_files f where f.book_id = b.id) as file_count
    from user_books b left join user_book_covers k on k.book_id = b.id
    where b.id = ${bookId} and b.user_id = ${userId} and b.status = 'ready' and b.format = 'audio'`
  if (!book) return null
  const chapters = await audiobookChapters(db, userId, bookId)
  return {
    id: bookId,
    title: book.title,
    author: book.author,
    narrator: book.narrator,
    language: book.language,
    details: detailsOf(book),
    openLibraryWork: book.open_library_work,
    cover: coverMetaOf(book),
    readyAt: book.ready_at,
    audioMs: Number(book.audio_ms),
    audioBytes: Number(book.audio_bytes),
    type: typeOfMedia(book.media_type),
    fileCount: book.file_count,
    chapters,
  }
}

export async function audiobookChapters(db: Db, userId: number, bookId: string): Promise<AudiobookChapterRow[]> {
  const rows = await db<{ position: number; title: string; file_n: number; start_ms: number; duration_ms: number }[]>`
    select c.position, c.title, c.file_n, c.start_ms, c.duration_ms
    from user_book_audio_chapters c join user_books b on b.id = c.book_id
    where c.book_id = ${bookId} and b.user_id = ${userId} and b.status = 'ready' and b.format = 'audio'
    order by c.position`
  return rows.map((chapter) => ({
    position: chapter.position,
    title: chapter.title,
    fileN: chapter.file_n,
    startMs: chapter.start_ms,
    durationMs: chapter.duration_ms,
  }))
}

export async function readyAudioFile(
  db: Db,
  userId: number,
  bookId: string,
  fileNumber: number,
): Promise<{ mediaType: MediaType; bytes: number } | null> {
  const [row] = await db<{ media_type: MediaType; bytes: string }[]>`
    select f.media_type, f.bytes
    from user_book_audio_files f join user_books b on b.id = f.book_id
    where f.book_id = ${bookId} and f.n = ${fileNumber} and b.user_id = ${userId} and b.status = 'ready' and b.format = 'audio'`
  return row ? { mediaType: row.media_type, bytes: Number(row.bytes) } : null
}

export async function rewindFile(
  db: Db,
  userId: number,
  bookId: string,
  fileNumber: number,
  size: number,
): Promise<void> {
  await db`
    update user_book_audio_files f set received = least(f.received, ${size})
    from user_books b
    where f.book_id = ${bookId} and f.n = ${fileNumber} and b.id = f.book_id and b.user_id = ${userId}
      and b.status = 'uploading'`
}
