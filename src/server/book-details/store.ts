import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import type { CoverSource, PrivateCoverMeta } from '../../shared/content/private-book.ts'
import type { BookDetails } from '../../shared/import/details.ts'
import type { ImageInfo } from '../../shared/import/image.ts'
import type { Db, Pool } from '../db.ts'

export interface NewCover {
  bytes: Uint8Array
  info: ImageInfo
  source: CoverSource
  sha256: string
}

export const newCover = (bytes: Uint8Array, info: ImageInfo, source: CoverSource): NewCover => ({
  bytes,
  info,
  source,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})

export interface CoverColumns {
  cover_width: number | null
  cover_height: number | null
  cover_sha256: string | null
  cover_source: string | null
}

export function coverMetaOf(row: CoverColumns): PrivateCoverMeta | null {
  if (row.cover_width === null || row.cover_height === null || !row.cover_sha256 || !row.cover_source) return null
  return {
    width: row.cover_width,
    height: row.cover_height,
    sha256: row.cover_sha256,
    source: row.cover_source as CoverSource,
  }
}

async function upsertCover(tx: Db, bookId: string, cover: NewCover): Promise<void> {
  await tx`
    insert into user_book_covers (book_id, media_type, bytes, width, height, source, sha256)
    values (${bookId}, ${cover.info.type}, ${Buffer.from(cover.bytes)}, ${cover.info.width}, ${cover.info.height},
      ${cover.source}, ${cover.sha256})
    on conflict (book_id) do update set media_type = excluded.media_type, bytes = excluded.bytes,
      width = excluded.width, height = excluded.height, source = excluded.source, sha256 = excluded.sha256,
      updated_at = now()`
}

export function setCover(pool: Pool, userId: number, bookId: string, cover: NewCover): Promise<'ok' | 'missing'> {
  return pool.begin(async (tx): Promise<'ok' | 'missing'> => {
    const [book] = await tx`
      select id from user_books where id = ${bookId} and user_id = ${userId} and status in ('uploading', 'ready')
      for update`
    if (!book) return 'missing'
    await upsertCover(tx, bookId, cover)
    return 'ok'
  })
}

export async function isReadyBook(db: Db, userId: number, bookId: string): Promise<boolean> {
  const [book] = await db`select 1 from user_books where id = ${bookId} and user_id = ${userId} and status = 'ready'`
  return Boolean(book)
}

export async function removeCover(db: Db, userId: number, bookId: string): Promise<boolean> {
  const [book] = await db`select 1 from user_books where id = ${bookId} and user_id = ${userId}`
  if (!book) return false
  await db`delete from user_book_covers where book_id = ${bookId}`
  return true
}

export async function readCover(
  db: Db,
  userId: number,
  bookId: string,
): Promise<{ mediaType: 'image/jpeg' | 'image/png'; bytes: Uint8Array } | null> {
  const [row] = await db<{ media_type: 'image/jpeg' | 'image/png'; bytes: Buffer }[]>`
    select k.media_type, k.bytes
    from user_book_covers k join user_books b on b.id = k.book_id
    where k.book_id = ${bookId} and b.user_id = ${userId} and b.status = 'ready'`
  return row ? { mediaType: row.media_type, bytes: new Uint8Array(row.bytes) } : null
}

export interface EditableDetails extends BookDetails {
  title: string
  author: string
}

const EDITABLE: readonly (keyof EditableDetails)[] = [
  'title',
  'author',
  'description',
  'isbn',
  'publisher',
  'publishedYear',
]

export function saveDetails(
  pool: Pool,
  userId: number,
  bookId: string,
  details: EditableDetails,
): Promise<{ changed: (keyof EditableDetails)[] } | 'missing'> {
  return pool.begin(async (tx) => {
    const [old] = await tx<
      {
        title: string
        author: string
        description: string | null
        isbn: string | null
        publisher: string | null
        publishedYear: number | null
      }[]
    >`
      select title, author, description, isbn, publisher, published_year as "publishedYear" from user_books
      where id = ${bookId} and user_id = ${userId} and status = 'ready'
      for update`
    if (!old) return 'missing' as const
    await tx`
      update user_books set title = ${details.title}, author = ${details.author}, description = ${details.description},
        isbn = ${details.isbn}, publisher = ${details.publisher}, published_year = ${details.publishedYear}
      where id = ${bookId}`
    return { changed: EDITABLE.filter((key) => old[key] !== details[key]) }
  })
}

export interface AppliedMatch {
  description?: string | null
  isbn?: string | null
  publishedYear?: number | null
  work: string
  cover?: NewCover | null
}

export type ApplyResult =
  | { changed: { description: boolean; cover: boolean; isbn: boolean; year: boolean } }
  | 'missing'

export function applyMatch(pool: Pool, userId: number, bookId: string, match: AppliedMatch): Promise<ApplyResult> {
  return pool.begin(async (tx): Promise<ApplyResult> => {
    const [book] = await tx<{ description: string | null; isbn: string | null; published_year: number | null }[]>`
      select description, isbn, published_year from user_books
      where id = ${bookId} and user_id = ${userId} and status = 'ready'
      for update`
    if (!book) return 'missing'
    const description = match.description ?? null
    const isbn = book.isbn ?? match.isbn ?? null
    const year = book.published_year ?? match.publishedYear ?? null
    await tx`
      update user_books set description = ${description ?? book.description}, isbn = ${isbn},
        published_year = ${year}, open_library_work = ${match.work}
      where id = ${bookId}`
    if (match.cover) await upsertCover(tx, bookId, match.cover)
    return {
      changed: {
        description: description !== null && description !== book.description,
        cover: Boolean(match.cover),
        isbn: isbn !== book.isbn,
        year: year !== book.published_year,
      },
    }
  })
}
