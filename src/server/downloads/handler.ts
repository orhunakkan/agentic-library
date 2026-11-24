import '@tanstack/react-start/server-only'
import { isCatalogueBookSlug } from '~/shared/content/book-slug'
import { isOfflineSlug } from '~/shared/offline/book'
import { forbidden, NO_STORE, noStoreJson, readerOf } from '../auth.ts'
import { openBook } from '../books/book.ts'
import { logError } from '../redact.ts'

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': NO_STORE } })

export async function handleOfflineBook(request: Request, file: string): Promise<Response> {
  const slug = /^(.+)\.json$/.exec(file)?.[1]
  if (!slug) return notFound()
  if (request.headers.get('sec-fetch-site') === 'cross-site') return forbidden()
  try {
    if (!isOfflineSlug(slug)) return notFound()
    const { db, userId } = await readerOf(request)
    const book = await openBook(db, userId, slug)
    const copy = book?.format === 'text' ? await book.offlineCopy() : null
    if (!copy) return notFound()
    return isCatalogueBookSlug(slug)
      ? Response.json(copy, { headers: { 'cache-control': 'no-cache' } })
      : noStoreJson(200, copy)
  } catch (error) {
    logError('offline download', error)
    return noStoreJson(500, { error: 'failed' })
  }
}
