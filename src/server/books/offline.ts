import '@tanstack/react-start/server-only'
import { stat } from 'node:fs/promises'
import { privateBookSlug } from '~/shared/content/book-slug'
import { renderCoverSvg } from '~/shared/content/cover'
import type { BookMeta } from '~/shared/content/schema'
import { OFFLINE_BOOK_VERSION, type OfflineBook, trimCatalog } from '~/shared/offline/book'
import { pictureUrls } from '~/shared/offline/pictures'
import type { Db } from '../db.ts'
import { catalogueVersion, oncePerSlug, privateVersion } from '../downloads/version.ts'
import { catalogueBook, contentImageFile, coverFile, loadBook, loadCatalog } from '../repository.ts'
import { loadWholeBook, toChapterBook } from '../user-books.ts'
import { catalogueSpeechBook, privateContext, privateSpeechBook } from './views.ts'

const textBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))

const sizeOf = async (path: string | null) => (path ? ((await stat(path).catch(() => null))?.size ?? 0) : 0)

async function catalogueFileBytes(meta: BookMeta, pictures: readonly string[]): Promise<number> {
  const sizes = await Promise.all(
    pictures.map((url) => {
      const [, , slug = '', file = ''] = url.split('/')
      return contentImageFile(slug, file).then(sizeOf)
    }),
  )
  const cover = meta.coverImage
    ? await sizeOf((await coverFile(meta.slug))?.path ?? null)
    : Buffer.byteLength(renderCoverSvg(meta))
  return sizes.reduce((a, b) => a + b, 0) + cover
}

/** A catalogue book whole, built once per slug for everyone. */
export const catalogueOfflineBook = oncePerSlug(buildCatalogueBook)

async function buildCatalogueBook(slug: string): Promise<OfflineBook | null> {
  const [catalog, meta, content, version] = await Promise.all([
    loadCatalog(),
    catalogueBook(slug),
    loadBook(slug),
    catalogueVersion(slug),
  ])
  if (!meta || !content || !version) return null
  const pictures = pictureUrls(content)
  const context = { meta, catalog: trimCatalog(catalog, meta) }
  return {
    v: OFFLINE_BOOK_VERSION,
    slug,
    version,
    title: meta.title,
    author: meta.author,
    owner: null,
    context,
    content,
    cover: meta.cover,
    speech: catalogueSpeechBook(meta, content),
    pictures,
    bytes: textBytes([context, content]) + (await catalogueFileBytes(meta, pictures)),
  }
}

/** A private book whole for its owner, naming the owner by the username on the book's own row. */
export async function privateOfflineBook(db: Db, userId: number, bookId: string): Promise<OfflineBook | null> {
  const [[owner], book] = await Promise.all([
    db<{ username: string }[]>`
      select u.username from user_books b join users u on u.id = b.user_id
      where b.id = ${bookId} and b.user_id = ${userId}`,
    loadWholeBook(db, userId, bookId),
  ])
  if (!owner || !book) return null
  const slug = privateBookSlug(bookId)
  const context = privateContext(bookId, book, book.chapters.length)
  const content = toChapterBook(slug, book.chapters)
  const outline = book.chapters.map((c) => ({ slug: c.slug, title: c.title, pageCount: c.pages.length }))
  return {
    v: OFFLINE_BOOK_VERSION,
    slug,
    version: privateVersion(context, outline),
    title: book.title,
    author: book.author,
    owner: owner.username,
    context,
    content,
    cover: context.meta.cover,
    speech: privateSpeechBook(
      bookId,
      book,
      book.chapters.map((c) => c.title),
    ),
    pictures: pictureUrls(content),
    bytes: textBytes([context, content]) + book.imageBytes + book.coverBytes,
  }
}
