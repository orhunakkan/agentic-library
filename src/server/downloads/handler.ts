import '@tanstack/react-start/server-only'
import { isNotFound } from '@tanstack/react-router'
import { isPrivateBookSlug } from '~/shared/content/book-slug'
import { isOfflineSlug } from '~/shared/offline/book'
import { forbidden, NO_STORE, noStoreJson } from '../auth.ts'
import { getDb } from '../db.ts'
import { owned } from '../private-reading.ts'
import { logError } from '../redact.ts'
import { catalogueOfflineBook, privateOfflineBook } from './book.ts'

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': NO_STORE } })

async function ownerOf(slug: string, request: Request) {
  try {
    return await owned(slug, request)
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

export async function handleOfflineBook(request: Request, file: string): Promise<Response> {
  const slug = /^(.+)\.json$/.exec(file)?.[1]
  if (!slug) return notFound()
  if (request.headers.get('sec-fetch-site') === 'cross-site') return forbidden()
  try {
    if (isPrivateBookSlug(slug)) {
      const owner = await ownerOf(slug, request)
      const book = owner && (await privateOfflineBook(getDb(), owner.userId, owner.username, owner.bookId))
      return book ? noStoreJson(200, book) : notFound()
    }
    const book = isOfflineSlug(slug) ? await catalogueOfflineBook(slug) : null
    return book ? Response.json(book, { headers: { 'cache-control': 'no-cache' } }) : notFound()
  } catch (error) {
    logError('offline download', error)
    return noStoreJson(500, { error: 'failed' })
  }
}
