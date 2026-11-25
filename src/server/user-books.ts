import '@tanstack/react-start/server-only'
import type { PrivateCoverMeta } from '../shared/content/private-book.ts'
import type { ChapterBook } from '../shared/content/schema.ts'
import type { BookUpload } from '../shared/import/blocks.ts'
import type { BookDetails } from '../shared/import/details.ts'
import { MAX_BOOK_HTML_BYTES, MAX_BOOKS, MAX_USER_IMAGE_BYTES, STALE_UPLOAD_HOURS } from '../shared/import/limits.ts'
import { slugify, uniqueSlug } from '../shared/import/slug.ts'
import { isUuid } from '../shared/uuid.ts'
import { recordEvent } from './audit.ts'
import { type CoverColumns, coverMetaOf } from './book-details/store.ts'
import { imageBytesUsed } from './book-images/store.ts'
import type { Db, Pool } from './db.ts'
import { retryAtLocked } from './quota.ts'

export interface UserBook {
  id: string
  title: string
  author: string
  language: string
  chapterCount: number
  htmlBytes: number
  readyAt: Date
  firstChapter: string
  details: BookDetails
  cover: PrivateCoverMeta | null
  format: 'audio' | null
  audioMs: number | null
}

export interface UserArticle {
  id: string
  title: string
  author: string
  cover: PrivateCoverMeta | null
  url: string
  words: number
  savedAt: Date
  firstChapter: string
}

export interface DetailColumns {
  description: string | null
  isbn: string | null
  publisher: string | null
  published_year: number | null
}

export const detailsOf = (detailColumns: DetailColumns): BookDetails => ({
  description: detailColumns.description,
  isbn: detailColumns.isbn,
  publisher: detailColumns.publisher,
  publishedYear: detailColumns.published_year,
})

export const COVER_COLUMNS =
  'k.width as cover_width, k.height as cover_height, k.sha256 as cover_sha256, k.source as cover_source'

export async function sweepStaleUploads(db: Db, userId: number): Promise<number> {
  const result = await db`
    delete from user_books
    where user_id = ${userId} and status = 'uploading'
      and created_at < now() - make_interval(hours => ${STALE_UPLOAD_HOURS})`
  return result.count
}

export type StartResult =
  | { ok: true; id: string; imageBytesLeft: number }
  | { ok: false; reason: 'quota'; max: number }
  | { ok: false; reason: 'rate'; retryAt?: Date }
  | { ok: false; reason: 'exists'; id: string }
  | { ok: false; reason: 'room'; max: number }

export async function countedBooks(db: Db, userId: number): Promise<number> {
  const [count] = await db<{ n: string }[]>`
    select count(*) as n from user_books where user_id = ${userId} and article_url is null`
  return Number(count?.n ?? 0)
}

export async function countedArticles(db: Db, userId: number): Promise<number> {
  const [count] = await db<{ n: string }[]>`
    select count(*) as n from user_books where user_id = ${userId} and article_url is not null`
  return Number(count?.n ?? 0)
}

export async function findArticle(db: Db, userId: number, url: string): Promise<string | null> {
  const [row] = await db<{ id: string }[]>`
    select id from user_books
    where user_id = ${userId} and article_url = ${url} and status = 'ready'
    order by ready_at desc limit 1`
  return row?.id ?? null
}

export interface ArticleStart {
  url: string
  max: number
}

export async function startImport(
  pool: Pool,
  userId: number,
  book: Omit<BookUpload, 'images'> & { images?: BookUpload['images'] },
  now = new Date(),
  maxBooks = MAX_BOOKS,
  article?: ArticleStart,
): Promise<StartResult> {
  const images = book.images ?? { count: 0, bytes: 0 }
  return pool.begin(async (tx): Promise<StartResult> => {
    await tx`select id from users where id = ${userId} for update`
    await sweepStaleUploads(tx, userId)
    if (article) {
      const retryAt = await retryAtLocked(tx, userId, 'article-save', now)
      if (retryAt) return { ok: false, reason: 'rate', retryAt }
      const existing = await findArticle(tx, userId, article.url)
      if (existing) return { ok: false, reason: 'exists', id: existing }
      if ((await countedArticles(tx, userId)) >= article.max) return { ok: false, reason: 'quota', max: article.max }
    } else {
      if (await retryAtLocked(tx, userId, 'import', now)) return { ok: false, reason: 'rate' }
      if ((await countedBooks(tx, userId)) >= maxBooks) return { ok: false, reason: 'quota', max: maxBooks }
    }
    const left = MAX_USER_IMAGE_BYTES - (await imageBytesUsed(tx, userId))
    if (images.bytes > left) return { ok: false, reason: 'room', max: MAX_USER_IMAGE_BYTES }
    const [row] = await tx<{ id: string }[]>`
      insert into user_books
        (user_id, title, author, language, chapter_count, description, isbn, publisher, published_year,
          image_count, image_bytes, article_url)
      values (${userId}, ${book.title}, ${book.author}, ${book.language}, ${book.chapterCount},
        ${book.details.description}, ${book.details.isbn}, ${book.details.publisher}, ${book.details.publishedYear},
        ${images.count}, ${images.bytes}, ${article?.url ?? null})
      returning id`
    if (!row) throw new Error('insert returned no row')
    return { ok: true, id: row.id, imageBytesLeft: left - images.bytes }
  })
}

export type ChapterResult = 'ok' | 'missing' | 'position' | 'too-big'

const byteLength = (pages: readonly string[]) => pages.reduce((n, p) => n + Buffer.byteLength(p, 'utf8'), 0)

export async function storeChapter(
  pool: Pool,
  userId: number,
  bookId: string,
  position: number,
  chapter: { title: string; pages: string[] },
): Promise<ChapterResult> {
  return pool.begin(async (tx): Promise<ChapterResult> => {
    const [book] = await tx<{ chapter_count: number; html_bytes: string }[]>`
      select chapter_count, html_bytes from user_books
      where id = ${bookId} and user_id = ${userId} and status = 'uploading'
      for update`
    if (!book) return 'missing'
    if (position >= book.chapter_count) return 'position'
    const [previous] = await tx<{ bytes: string }[]>`
      select (select coalesce(sum(octet_length(p)), 0) from jsonb_array_elements_text(pages) p) as bytes
      from user_book_chapters where book_id = ${bookId} and position = ${position}`
    const total = Number(book.html_bytes) - Number(previous?.bytes ?? 0) + byteLength(chapter.pages)
    if (total > MAX_BOOK_HTML_BYTES) return 'too-big'

    const others = await tx<{ slug: string }[]>`
      select slug from user_book_chapters where book_id = ${bookId} and position <> ${position}`
    const slug = uniqueSlug(slugify(chapter.title) || `chapter-${position + 1}`, new Set(others.map((o) => o.slug)))
    await tx`
      insert into user_book_chapters (book_id, position, slug, title, pages)
      values (${bookId}, ${position}, ${slug}, ${chapter.title}, ${tx.json(chapter.pages)})
      on conflict (book_id, position) do update set slug = excluded.slug, title = excluded.title, pages = excluded.pages`
    await tx`update user_books set html_bytes = ${total} where id = ${bookId}`
    return 'ok'
  })
}

export type FinishResult = 'ok' | 'missing' | 'incomplete'

function wordsInPages(pages: readonly string[]): number {
  return pages.reduce((n, page) => {
    const text = page.replace(/<[^>]*>/g, ' ').trim()
    return n + (text ? text.split(/\s+/).length : 0)
  }, 0)
}

export async function finishImport(
  pool: Pool,
  userId: number,
  bookId: string,
  ip: string | null,
): Promise<FinishResult> {
  return pool.begin(async (tx): Promise<FinishResult> => {
    const [book] = await tx<
      { chapter_count: number; html_bytes: string; image_count: number | null; article_url: string | null }[]
    >`
      select chapter_count, html_bytes, image_count, article_url from user_books
      where id = ${bookId} and user_id = ${userId} and status = 'uploading'
      for update`
    if (!book) return 'missing'
    const [stored] = await tx<{ chapters: string; images: string }[]>`
      select (select count(*) from user_book_chapters where book_id = ${bookId}) as chapters,
        (select count(*) from user_book_images where book_id = ${bookId}) as images`
    if (Number(stored?.chapters ?? 0) !== book.chapter_count) return 'incomplete'
    if (Number(stored?.images ?? 0) !== (book.image_count ?? 0)) return 'incomplete'
    if (book.article_url !== null) {
      const chapters = await tx<{ pages: string[] }[]>`select pages from user_book_chapters where book_id = ${bookId}`
      const words = wordsInPages(chapters.flatMap((c) => c.pages))
      await tx`
        update user_books set status = 'ready', ready_at = now(), article_words = ${words} where id = ${bookId}`
      await recordEvent(tx, 'article.saved', { userId, ip, detail: { id: bookId, pictures: book.image_count ?? 0 } })
      return 'ok'
    }
    await tx`update user_books set status = 'ready', ready_at = now() where id = ${bookId}`
    await recordEvent(tx, 'book.imported', {
      userId,
      ip,
      detail: { bookId, chapters: book.chapter_count, htmlBytes: Number(book.html_bytes) },
    })
    return 'ok'
  })
}

export async function listBooks(db: Db, userId: number): Promise<UserBook[]> {
  const rows = await db<
    ({
      id: string
      title: string
      author: string
      language: string
      chapter_count: number
      html_bytes: string
      ready_at: Date
      first_chapter: string | null
      format: 'audio' | null
      audio_ms: string | null
    } & DetailColumns &
      CoverColumns)[]
  >`
    select b.id, b.title, b.author, b.language, b.chapter_count, b.html_bytes, b.ready_at, b.format, b.audio_ms,
      b.description, b.isbn, b.publisher, b.published_year, ${db.unsafe(COVER_COLUMNS)},
      (select c.slug from user_book_chapters c where c.book_id = b.id and c.position = 0) as first_chapter
    from user_books b left join user_book_covers k on k.book_id = b.id
    where b.user_id = ${userId} and b.status = 'ready' and b.article_url is null
    order by b.ready_at desc, b.id`
  return rows.map((book) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    language: book.language,
    chapterCount: book.chapter_count,
    htmlBytes: Number(book.html_bytes),
    readyAt: book.ready_at,
    firstChapter: book.first_chapter ?? 'chapter-1',
    details: detailsOf(book),
    cover: coverMetaOf(book),
    format: book.format,
    audioMs: book.audio_ms === null ? null : Number(book.audio_ms),
  }))
}

export async function listArticles(db: Db, userId: number): Promise<UserArticle[]> {
  const rows = await db<
    ({
      id: string
      title: string
      author: string
      article_url: string
      article_words: number | null
      ready_at: Date
      first_chapter: string | null
    } & CoverColumns)[]
  >`
    select b.id, b.title, b.author, b.article_url, b.article_words, b.ready_at, ${db.unsafe(COVER_COLUMNS)},
      (select c.slug from user_book_chapters c where c.book_id = b.id and c.position = 0) as first_chapter
    from user_books b left join user_book_covers k on k.book_id = b.id
    where b.user_id = ${userId} and b.status = 'ready' and b.article_url is not null
    order by b.ready_at desc, b.id`
  return rows.map((article) => ({
    id: article.id,
    title: article.title,
    author: article.author,
    cover: coverMetaOf(article),
    url: article.article_url,
    words: article.article_words ?? 0,
    savedAt: article.ready_at,
    firstChapter: article.first_chapter ?? 'chapter-1',
  }))
}

export async function deleteArticle(db: Db, userId: number, bookId: string): Promise<boolean> {
  const result = await db`
    delete from user_books where id = ${bookId} and user_id = ${userId} and article_url is not null`
  return result.count > 0
}

export async function deleteBook(db: Db, userId: number, bookId: string): Promise<boolean> {
  const result = await db`delete from user_books where id = ${bookId} and user_id = ${userId}`
  return result.count > 0
}

export interface BookChapterRow {
  slug: string
  title: string
  pageCount: number
}

export interface ReaderBook {
  title: string
  author: string
  language: string
  description: string | null
  cover: PrivateCoverMeta | null
  chapters: BookChapterRow[]
  html: string | null
}

export async function loadReaderBook(
  db: Db,
  userId: number,
  bookId: string,
  chapterSlug: string,
  pageIndex: number,
): Promise<ReaderBook | null> {
  const [book] = await db<
    ({ title: string; author: string; language: string; description: string | null } & CoverColumns)[]
  >`
    select b.title, b.author, b.language, b.description, ${db.unsafe(COVER_COLUMNS)}
    from user_books b left join user_book_covers k on k.book_id = b.id
    where b.id = ${bookId} and b.user_id = ${userId} and b.status = 'ready' and b.format is null`
  if (!book) return null
  const rows = await db<{ slug: string; title: string; page_count: number; html: string | null }[]>`
    select c.slug, c.title, jsonb_array_length(c.pages) as page_count,
      case when c.slug = ${chapterSlug} then c.pages ->> ${pageIndex}::int end as html
    from user_book_chapters c join user_books b on b.id = c.book_id
    where c.book_id = ${bookId} and b.user_id = ${userId}
    order by c.position`
  return {
    title: book.title,
    author: book.author,
    language: book.language,
    description: book.description,
    cover: coverMetaOf(book),
    chapters: rows.map((r) => ({ slug: r.slug, title: r.title, pageCount: r.page_count })),
    html: rows.find((r) => r.slug === chapterSlug)?.html ?? null,
  }
}

export interface BookPageData {
  id: string
  title: string
  author: string
  language: string
  details: BookDetails
  openLibraryWork: string | null
  cover: PrivateCoverMeta | null
  readyAt: Date
  chapters: BookChapterRow[]
  imageCount: number
  articleUrl: string | null
  articleWords: number | null
}

export async function loadBookPage(db: Db, userId: number, bookId: string): Promise<BookPageData | null> {
  if (!isUuid(bookId)) return null
  const [book] = await db<
    ({
      title: string
      author: string
      language: string
      ready_at: Date
      open_library_work: string | null
      image_count: number | null
      article_url: string | null
      article_words: number | null
    } & DetailColumns &
      CoverColumns)[]
  >`
    select b.title, b.author, b.language, b.ready_at, b.open_library_work, b.image_count, b.article_url, b.article_words,
      b.description, b.isbn, b.publisher, b.published_year, ${db.unsafe(COVER_COLUMNS)}
    from user_books b left join user_book_covers k on k.book_id = b.id
    where b.id = ${bookId} and b.user_id = ${userId} and b.status = 'ready' and b.format is null`
  if (!book) return null
  const rows = await db<{ slug: string; title: string; page_count: number }[]>`
    select c.slug, c.title, jsonb_array_length(c.pages) as page_count
    from user_book_chapters c join user_books b on b.id = c.book_id
    where c.book_id = ${bookId} and b.user_id = ${userId}
    order by c.position`
  return {
    id: bookId,
    title: book.title,
    author: book.author,
    language: book.language,
    details: detailsOf(book),
    openLibraryWork: book.open_library_work,
    cover: coverMetaOf(book),
    readyAt: book.ready_at,
    chapters: rows.map((r) => ({ slug: r.slug, title: r.title, pageCount: r.page_count })),
    imageCount: book.image_count ?? 0,
    articleUrl: book.article_url,
    articleWords: book.article_url === null ? null : (book.article_words ?? 0),
  }
}

export interface BookOutline {
  title: string
  chapters: BookChapterRow[]
}

export async function loadOutlines(db: Db, userId: number, ids: readonly string[]): Promise<Map<string, BookOutline>> {
  const wanted = [...new Set(ids)].filter(isUuid)
  const outlines = new Map<string, BookOutline>()
  if (!wanted.length) return outlines
  const rows = await db<
    { id: string; title: string; slug: string | null; chapter_title: string | null; page_count: number | null }[]
  >`
    select b.id, b.title, c.slug, c.title as chapter_title, jsonb_array_length(c.pages) as page_count
    from user_books b left join user_book_chapters c on c.book_id = b.id
    where b.id = any(${wanted}::uuid[]) and b.user_id = ${userId} and b.status = 'ready' and b.format is null
    order by b.id, c.position`
  for (const row of rows) {
    let outline = outlines.get(row.id)
    if (!outline) {
      outline = { title: row.title, chapters: [] }
      outlines.set(row.id, outline)
    }
    if (row.slug !== null && row.chapter_title !== null && row.page_count !== null)
      outline.chapters.push({ slug: row.slug, title: row.chapter_title, pageCount: row.page_count })
  }
  return outlines
}

export interface StoredChapter {
  slug: string
  title: string
  pages: string[]
}

export function toChapterBook(slug: string, chapters: readonly StoredChapter[]): ChapterBook {
  return {
    kind: 'chapter',
    slug,
    chapters: chapters.map((c, i) => ({ id: `ch_${i + 1}`, slug: c.slug, title: c.title, pages: c.pages })),
  }
}

export async function loadSpeechChapter(
  db: Db,
  userId: number,
  bookId: string,
  position: number,
): Promise<{
  title: string
  author: string
  language: string
  chapterCount: number
  chapterTitles: string[]
  chapter: StoredChapter
  cover: PrivateCoverMeta | null
} | null> {
  const [row] = await db<
    ({
      title: string
      author: string
      language: string
      chapter_count: number
      slug: string
      chapter_title: string
      pages: string[]
      chapter_titles: string[]
    } & CoverColumns)[]
  >`
    select b.title, b.author, b.language, b.chapter_count, c.slug, c.title as chapter_title, c.pages,
      ${db.unsafe(COVER_COLUMNS)},
      array(select t.title from user_book_chapters t where t.book_id = b.id order by t.position) as chapter_titles
    from user_books b join user_book_chapters c on c.book_id = b.id and c.position = ${position}
      left join user_book_covers k on k.book_id = b.id
    where b.id = ${bookId} and b.user_id = ${userId} and b.status = 'ready' and b.format is null`
  if (!row) return null
  return {
    title: row.title,
    author: row.author,
    language: row.language,
    chapterCount: row.chapter_count,
    chapterTitles: row.chapter_titles,
    chapter: { slug: row.slug, title: row.chapter_title, pages: row.pages },
    cover: coverMetaOf(row),
  }
}

export async function loadWholeBook(db: Db, userId: number, bookId: string): Promise<WholeBook | null> {
  const [book] = await db<
    ({
      title: string
      author: string
      language: string
      description: string | null
      image_bytes: number | null
      cover_bytes: number | null
    } & CoverColumns)[]
  >`
    select b.title, b.author, b.language, b.description, b.image_bytes, octet_length(k.bytes) as cover_bytes,
      ${db.unsafe(COVER_COLUMNS)}
    from user_books b left join user_book_covers k on k.book_id = b.id
    where b.id = ${bookId} and b.user_id = ${userId} and b.status = 'ready' and b.format is null`
  if (!book) return null
  const chapters = await loadBookText(db, userId, bookId)
  return (
    chapters && {
      title: book.title,
      author: book.author,
      language: book.language,
      description: book.description,
      cover: coverMetaOf(book),
      imageBytes: book.image_bytes ?? 0,
      coverBytes: book.cover_bytes ?? 0,
      chapters,
    }
  )
}

export interface WholeBook {
  title: string
  author: string
  language: string
  description: string | null
  cover: PrivateCoverMeta | null
  imageBytes: number
  coverBytes: number
  chapters: StoredChapter[]
}

export async function loadBookText(db: Db, userId: number, bookId: string): Promise<StoredChapter[] | null> {
  const [book] =
    await db`select 1 from user_books where id = ${bookId} and user_id = ${userId} and status = 'ready' and format is null`
  if (!book) return null
  return db<StoredChapter[]>`
    select c.slug, c.title, c.pages
    from user_book_chapters c join user_books b on b.id = c.book_id
    where c.book_id = ${bookId} and b.user_id = ${userId}
    order by c.position`
}
