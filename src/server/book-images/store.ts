import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import type { ImageInfo } from '../../shared/import/image.ts'
import type { InstanceLimits } from '../../shared/limits/limits.ts'
import type { Db, Pool } from '../db.ts'

export type StoredImageType = 'image/jpeg' | 'image/png'

export interface NewImage {
  bytes: Uint8Array
  info: ImageInfo & { type: StoredImageType }
  sha256: string
}

export const newImage = (bytes: Uint8Array, info: ImageInfo & { type: StoredImageType }): NewImage => ({
  bytes,
  info,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})

export type StoreImageResult =
  | 'ok'
  | 'missing'
  | 'position'
  | { quota: 'book'; max: number }
  | { quota: 'user'; max: number }

export function storeImage(
  pool: Pool,
  userId: number,
  bookId: string,
  imageNumber: number,
  image: NewImage,
  limits: InstanceLimits,
): Promise<StoreImageResult> {
  return pool.begin(async (tx): Promise<StoreImageResult> => {
    await tx`select id from users where id = ${userId} for update`
    const [book] = await tx<{ image_count: number | null; image_bytes: number | null }[]>`
      select image_count, image_bytes from user_books
      where id = ${bookId} and user_id = ${userId} and status = 'uploading'`
    if (!book) return 'missing'
    if (imageNumber > (book.image_count ?? 0)) return 'position'
    const size = image.bytes.length
    const [used] = await tx<{ book: string; user: string }[]>`
      select
        coalesce(sum(octet_length(i.bytes)) filter (where i.book_id = ${bookId}), 0) as book,
        coalesce(sum(octet_length(i.bytes)), 0) as user
      from user_book_images i join user_books b on b.id = i.book_id
      where b.user_id = ${userId} and not (i.book_id = ${bookId} and i.n = ${imageNumber})`
    const bookMax = book.image_bytes ?? 0
    if (Number(used?.book ?? 0) + size > bookMax) return { quota: 'book', max: bookMax }
    if (Number(used?.user ?? 0) + size > limits.userPictureBytes) return { quota: 'user', max: limits.userPictureBytes }
    await tx`
      insert into user_book_images (book_id, n, media_type, bytes, width, height, sha256)
      values (${bookId}, ${imageNumber}, ${image.info.type}, ${Buffer.from(image.bytes)}, ${image.info.width},
        ${image.info.height}, ${image.sha256})
      on conflict (book_id, n) do update set media_type = excluded.media_type, bytes = excluded.bytes,
        width = excluded.width, height = excluded.height, sha256 = excluded.sha256, created_at = now()`
    return 'ok'
  })
}

export async function imageSizes(
  db: Db,
  userId: number,
  bookId: string,
): Promise<Map<number, { width: number; height: number }>> {
  const rows = await db<{ n: number; width: number; height: number }[]>`
    select i.n, i.width, i.height
    from user_book_images i join user_books b on b.id = i.book_id
    where i.book_id = ${bookId} and b.user_id = ${userId}`
  return new Map(rows.map((r) => [r.n, { width: r.width, height: r.height }]))
}

export async function storedImageCount(db: Db, userId: number, bookId: string): Promise<number> {
  const [row] = await db<{ n: string }[]>`
    select count(*) as n from user_book_images i join user_books b on b.id = i.book_id
    where i.book_id = ${bookId} and b.user_id = ${userId}`
  return Number(row?.n ?? 0)
}

export async function loadImage(
  db: Db,
  userId: number,
  bookId: string,
  imageNumber: number,
): Promise<{ mediaType: StoredImageType; bytes: Uint8Array; sha256: string } | null> {
  const [row] = await db<{ media_type: StoredImageType; bytes: Buffer; sha256: string }[]>`
    select i.media_type, i.bytes, i.sha256
    from user_book_images i join user_books b on b.id = i.book_id
    where i.book_id = ${bookId} and i.n = ${imageNumber} and b.user_id = ${userId} and b.status = 'ready'`
  return row ? { mediaType: row.media_type, bytes: new Uint8Array(row.bytes), sha256: row.sha256 } : null
}

export async function imageBytesUsed(db: Db, userId: number): Promise<number> {
  const [row] = await db<{ bytes: string }[]>`
    select coalesce(sum(octet_length(i.bytes)), 0) as bytes
    from user_book_images i join user_books b on b.id = i.book_id
    where b.user_id = ${userId}`
  return Number(row?.bytes ?? 0)
}
