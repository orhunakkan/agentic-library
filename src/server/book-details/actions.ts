import '@tanstack/react-start/server-only'
import { type CoverSource, privateCoverImage } from '../../shared/content/private-book.ts'
import { checkCoverImage } from '../../shared/import/image.ts'
import { MAX_COVER_BYTES } from '../../shared/import/limits.ts'
import { isUuid } from '../../shared/uuid.ts'
import { isObject } from '../ask/input.ts'
import { recordEvent } from '../audit.ts'
import { noStoreJson, requestIp, seeOther, sessionForRequest } from '../auth.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { readBytesBody } from '../json-body.ts'
import { take } from '../quota.ts'
import { logError } from '../redact.ts'
import { signedInEndpoints, signedInForm } from '../signed-in.ts'
import { parseApply, parseDetailsForm, parseLookup } from './input.ts'
import {
  cover as fetchCover,
  type OpenLibraryOptions,
  type OpenLibraryProblem,
  search,
  thumbUrl,
  work,
} from './open-library.ts'
import type { OpenLibraryMatch } from './open-library-parse.ts'
import {
  applyMatch,
  isReadyBook,
  type NewCover,
  newCover,
  readCover,
  removeCover,
  saveDetails,
  setCover,
} from './store.ts'

export type DetailsErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'image' | 'rate' | 'busy' | 'unavailable'

const LOOKUP_BODY_BYTES = 2 * 1024

const details = signedInEndpoints<DetailsErrorCode>({
  maxBytes: LOOKUP_BODY_BYTES,
  codes: { signedOut: 'signed_out', invalid: 'invalid', notFound: 'not_found', failed: 'unavailable' },
})
const { fail } = details
const notFound = () => fail(404, 'not_found')

const UPLOAD_SOURCES: readonly CoverSource[] = ['epub', 'zip', 'pdf', 'audio', 'upload']

export const handleCoverUpload = (request: Request, id: string) =>
  details.post(
    request,
    {
      log: 'book cover upload',
      signedOut: 404,
      body: 'none',
      before: () => {
        if (!isUuid(id)) return notFound()
        const source = (new URL(request.url).searchParams.get('source') ?? 'upload') as CoverSource
        return UPLOAD_SOURCES.includes(source) ? source : fail(400, 'invalid')
      },
    },
    async ({ session, db, pre: source }) => {
      const body = await readBytesBody(request, MAX_COVER_BYTES, ['image/jpeg', 'image/png'])
      if (!body.ok) {
        if (body.reason === 'content-type') return fail(415, 'image', { problem: 'type' })
        if (body.reason === 'too-large') return fail(413, 'image', { problem: 'large' })
        return fail(400, 'image', { problem: 'type' })
      }
      const checked = checkCoverImage(body.bytes)
      if (!checked.ok) return fail(400, 'image', { problem: checked.problem })
      const cover = newCover(body.bytes, checked.info, source)
      if ((await setCover(db, session.userId, id, cover)) === 'missing') return notFound()
      await recordEvent(db, 'book.cover_changed', {
        userId: session.userId,
        ip: requestIp(request),
        detail: { bookId: id, source },
      })
      const image = privateCoverImage(id, { ...checked.info, sha256: cover.sha256, source })
      return noStoreJson(200, { cover: { ...image, source } })
    },
  )

export const COVER_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'private, no-store',
} as const

export const imageText = (status: number, text: string) =>
  new Response(text, { status, headers: { 'content-type': 'text/plain', ...COVER_HEADERS } })

const coverNotFound = () => imageText(404, 'Not found')

export async function handleCoverGet(request: Request, id: string): Promise<Response> {
  if (!isUuid(id) || !isDatabaseConfigured()) return coverNotFound()
  const session = await sessionForRequest(request)
  if (!session) return coverNotFound()
  try {
    const cover = await readCover(getDb(), session.userId, id)
    if (!cover) return coverNotFound()
    return new Response(new Uint8Array(cover.bytes), {
      headers: { 'content-type': cover.mediaType, 'content-length': String(cover.bytes.length), ...COVER_HEADERS },
    })
  } catch (error) {
    logError('book cover read', error)
    return imageText(503, 'Unavailable')
  }
}

export type BookFormError = 'invalid' | 'invalid-isbn' | 'too-long' | 'missing' | 'unavailable'

export function handleBookForm(request: Request, id: string): Promise<Response> {
  const page = `/account/books/${id}`
  const back = (query: string) => seeOther(`${page}?${query}`)
  const before = () =>
    isUuid(id) ? undefined : new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  return signedInForm(request, { log: 'book details form', next: page, before }, async ({ session, db, form }) => {
    const input = parseDetailsForm(form)
    if ('problem' in input) return back(`error=${input.problem}`)
    const audit = { userId: session.userId, ip: requestIp(request) }
    if (input.intent === 'remove-cover') {
      if (!(await removeCover(db, session.userId, id))) return back('error=missing')
      await recordEvent(db, 'book.cover_changed', { ...audit, detail: { bookId: id, source: 'generated' } })
      return back('status=cover-removed')
    }
    const saved = await saveDetails(db, session.userId, id, {
      title: input.title,
      author: input.author,
      ...input.details,
    })
    if (saved === 'missing') return back('error=missing')
    if (saved.changed.length)
      await recordEvent(db, 'book.details_changed', { ...audit, detail: { bookId: id, fields: saved.changed } })
    return back('status=saved')
  })
}

const recentSearches = new Map<number, { at: number; isbn: string | null; years: Map<string, number | null> }>()
const RECENT_MS = 60 * 60_000
const RECENT_MAX = 1000

function rememberSearch(userId: number, isbn: string | null, matches: readonly OpenLibraryMatch[]): void {
  recentSearches.delete(userId)
  recentSearches.set(userId, { at: Date.now(), isbn, years: new Map(matches.map((m) => [m.work, m.year])) })
  while (recentSearches.size > RECENT_MAX) recentSearches.delete(recentSearches.keys().next().value as number)
}

function recentFacts(userId: number, work: string): { isbn: string | null; year: number | null } {
  const recent = recentSearches.get(userId)
  if (!recent || Date.now() - recent.at > RECENT_MS || !recent.years.has(work)) return { isbn: null, year: null }
  return { isbn: recent.isbn, year: recent.years.get(work) ?? null }
}

const openLibraryFailure = (problem: OpenLibraryProblem) =>
  problem === 'busy' ? fail(503, 'busy') : fail(502, 'unavailable')

function parseLookupBody(value: unknown) {
  if (!isObject(value)) return null
  const { book, ...fields } = value
  return typeof book === 'string' && isUuid(book) ? { book, fields } : notFound()
}

export const handleLookup = (request: Request, options: OpenLibraryOptions = {}) =>
  details.post(request, { log: 'book lookup', parse: parseLookupBody }, async ({ session, db, input }) => {
    const { book, fields } = input
    const { userId } = session
    if (!(await isReadyBook(db, userId, book))) return notFound()
    const query = parseLookup(fields)
    if (!query) return fail(400, 'invalid')
    const taken = await take(db, userId, 'book-lookup', {
      ip: requestIp(request),
      detail: { bookId: book, kind: 'search', by: query.by },
    })
    if (!taken.ok) return fail(429, 'rate', { retryAt: taken.retryAt.toISOString() })
    const found = await search(query, options)
    await taken.settle(found.ok ? { matches: found.value.length } : { problem: found.problem })
    if (!found.ok) return openLibraryFailure(found.problem)
    rememberSearch(userId, query.by === 'isbn' ? query.isbn : null, found.value)
    return noStoreJson(200, {
      matches: found.value.map((m) => ({ ...m, thumb: m.coverId ? thumbUrl(m.coverId) : null })),
    })
  })

export type CoverProblem = 'cover-too-large' | 'cover-failed'

export const handleApply = (request: Request, id: string, options: OpenLibraryOptions = {}) =>
  details.post(
    request,
    {
      log: 'book apply match',
      before: () => (isUuid(id) ? undefined : notFound()),
      parse: parseApply,
    },
    async ({ session, db, input }) => {
      const { userId } = session
      if (!(await isReadyBook(db, userId, id))) return notFound()
      const ip = requestIp(request)
      const taken = await take(db, userId, 'book-lookup', { ip, detail: { bookId: id, kind: 'apply' } })
      if (!taken.ok) return fail(429, 'rate', { retryAt: taken.retryAt.toISOString() })

      let description: string | null = null
      let workProblem: OpenLibraryProblem | null = null
      if (input.useDescription) {
        const found = await work(input.work, options)
        if (found.ok) description = found.value.description
        else workProblem = found.problem
      }
      let cover: NewCover | null = null
      let coverProblem: CoverProblem | undefined
      if (input.useCover && input.coverId !== null) {
        const fetched = await fetchCover(input.coverId, options)
        if (fetched.ok) {
          const checked = checkCoverImage(fetched.value)
          if (checked.ok) cover = newCover(fetched.value, checked.info, 'open-library')
          else coverProblem = checked.problem === 'large' ? 'cover-too-large' : 'cover-failed'
        } else coverProblem = fetched.problem === 'too-large' ? 'cover-too-large' : 'cover-failed'
      }

      const audit = { userId, ip }
      if (workProblem && !cover) {
        await taken.settle({ problem: workProblem })
        return openLibraryFailure(workProblem)
      }
      const facts = recentFacts(userId, input.work)
      const applied = await applyMatch(db, userId, id, {
        work: input.work,
        description,
        isbn: facts.isbn,
        publishedYear: facts.year,
        cover,
      })
      if (applied === 'missing') return notFound()
      const { changed } = applied
      const problem = coverProblem ?? workProblem
      await taken.settle({
        cover: changed.cover,
        description: changed.description,
        ...(problem ? { problem } : {}),
      })
      const fields = [changed.description && 'description', changed.isbn && 'isbn', changed.year && 'publishedYear']
      const named = fields.filter((f): f is string => typeof f === 'string')
      if (named.length)
        await recordEvent(db, 'book.details_changed', { ...audit, detail: { bookId: id, fields: named } })
      if (changed.cover)
        await recordEvent(db, 'book.cover_changed', { ...audit, detail: { bookId: id, source: 'open-library' } })
      const image =
        cover && privateCoverImage(id, { ...cover.info, sha256: cover.sha256, source: 'open-library' as const })
      return noStoreJson(200, {
        changed,
        cover: image ? { ...image, source: 'open-library' } : null,
        ...(coverProblem ? { coverProblem } : {}),
      })
    },
  )
