import '@tanstack/react-start/server-only'
import { checkBookUpload, checkChapterUpload, UploadError } from '../shared/import/blocks.ts'
import { MAX_CHAPTER_REQUEST_BYTES, MAX_CHAPTERS, MAX_META_REQUEST_BYTES } from '../shared/import/limits.ts'
import { paginate } from '../shared/import/paginate.ts'
import { type RenderContext, renderBlocks } from '../shared/import/render.ts'
import { isObject } from '../shared/lib/json-shape.ts'
import { limitsFor } from '../shared/plans/plans.ts'
import { isUuid } from '../shared/uuid.ts'
import { take } from './articles/pending.ts'
import { forgetBookAudio } from './audiobooks/files.ts'
import { recordEvent } from './audit.ts'
import { noStoreJson, requestIp, seeOther } from './auth.ts'
import { imageSizes } from './book-images/store.ts'
import { type Codes, signedInEndpoints, signedInForm } from './signed-in.ts'
import { deleteBook, finishImport, startImport, storeChapter } from './user-books.ts'

export type ImportErrorCode =
  | 'signed-out'
  | 'not-found'
  | 'invalid'
  | 'too-long'
  | 'empty'
  | 'request-too-large'
  | 'book-too-large'
  | 'quota'
  | 'rate'
  | 'incomplete'
  | 'unavailable'
  | 'failed'

export const IMPORT_CODES: Codes<ImportErrorCode> = {
  signedOut: 'signed-out',
  invalid: 'invalid',
  notFound: 'not-found',
  failed: 'failed',
  tooLarge: 'request-too-large',
}

const imports = signedInEndpoints<ImportErrorCode>({ maxBytes: MAX_META_REQUEST_BYTES, codes: IMPORT_CODES })
const { fail } = imports
const notFound = () => fail(404, 'not-found')

function checked<T>(check: () => T): T | Response {
  try {
    return check()
  } catch (error) {
    if (error instanceof UploadError) return fail(400, error.code)
    throw error
  }
}

function articleOf(value: unknown): { book: unknown; article: string | null | undefined } {
  if (!isObject(value) || !('article' in value)) return { book: value, article: undefined }
  const { article, ...book } = value
  return { book, article: typeof article === 'string' && isUuid(article) ? article : null }
}

function parseStart(value: unknown) {
  const { book, article } = articleOf(value)
  if (article === null) return null
  return checked(() => ({ book: checkBookUpload(book, MAX_CHAPTERS), article }))
}

export const handleNewBook = (request: Request) =>
  imports.post(request, { log: 'book import start', parse: parseStart }, async ({ session, db, input }) => {
    const { book, article } = input
    const { plan, userId } = session
    const pending = article ? take(userId, article) : null
    if (article && !pending) return noStoreJson(409, { error: 'expired' })
    const limits = limitsFor(plan)
    const start = pending ? { url: pending.url, max: limits.articles } : undefined
    const result = await startImport(db, userId, book, new Date(), limits.books, start)
    if (!result.ok) {
      if (result.reason === 'room') return noStoreJson(409, { error: 'quota', scope: 'user', max: result.max })
      if (result.reason === 'exists') return noStoreJson(409, { error: 'exists', id: result.id })
      const scope = start ? 'articles' : 'books'
      if (result.reason === 'quota') return noStoreJson(409, { error: 'quota', scope, max: result.max, plan })
      if (start) return noStoreJson(429, { error: 'limited', retryAt: result.retryAt?.toISOString() ?? null })
      return fail(429, 'rate')
    }
    return noStoreJson(201, { id: result.id, imageBytesLeft: result.imageBytesLeft })
  })

export const handleChapter = (request: Request, id: string, position: string) =>
  imports.post(
    request,
    {
      log: 'book import chapter',
      signedOut: 404,
      body: { json: MAX_CHAPTER_REQUEST_BYTES },
      before: () => (isUuid(id) && /^\d{1,4}$/.test(position) ? undefined : notFound()),
      parse: (value) => checked(() => checkChapterUpload(value)),
    },
    async ({ session, db, input: chapter }) => {
      const numbers = chapter.blocks.flatMap((b) => (b.type === 'image' && b.image > 0 ? [b.image] : []))
      const sizes = numbers.length ? await imageSizes(db, session.userId, id) : new Map()
      if (numbers.some((n) => !sizes.has(n))) return fail(400, 'invalid')
      const context: RenderContext = {
        imageSrc: (n) => `/account/books/${id}/images/${n}`,
        imageSize: (n) => sizes.get(n) ?? null,
      }
      const pages = paginate(renderBlocks(chapter.blocks, context))
      if (!pages.length) return fail(400, 'empty')
      const result = await storeChapter(db, session.userId, id, Number(position), {
        title: chapter.title,
        pages,
      })
      if (result === 'missing') return notFound()
      if (result === 'position') return fail(400, 'invalid')
      if (result === 'too-big') return fail(413, 'book-too-large')
      return noStoreJson(200, { ok: true })
    },
  )

export const handleFinish = (request: Request, id: string) =>
  imports.post(
    request,
    {
      log: 'book import finish',
      signedOut: 404,
      body: 'none',
      before: () => (isUuid(id) ? undefined : notFound()),
    },
    async ({ session, db }) => {
      const result = await finishImport(db, session.userId, id, requestIp(request))
      if (result === 'missing') return notFound()
      if (result === 'incomplete') return fail(409, 'incomplete')
      return noStoreJson(200, { ok: true })
    },
  )

export const handleBooksForm = (request: Request) =>
  signedInForm(request, { log: 'book delete', next: '/account/books' }, async ({ session, db, form }) => {
    const id = form.get('id')
    if (form.get('intent') !== 'delete' || typeof id !== 'string' || !isUuid(id))
      return seeOther('/account/books?error=invalid')
    if (!(await deleteBook(db, session.userId, id))) return seeOther('/account/books?error=missing')
    await forgetBookAudio(session.userId, id)
    await recordEvent(db, 'book.deleted', { userId: session.userId, ip: requestIp(request), detail: { bookId: id } })
    return seeOther('/account/books?status=deleted')
  })
