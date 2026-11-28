import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { it, raw } from '../../../support/server/db-test'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import {
  handleApply,
  handleBookForm,
  handleCoverGet,
  handleCoverUpload,
  handleLookup,
  resetRecentSearches,
} from '~/server/book-details/actions'
import { resetOpenLibrary, search } from '~/server/book-details/open-library'
import { applyMatch, newCover, readCover, removeCover, saveDetails, setCover } from '~/server/book-details/store'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { LOOKUP_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { deleteBook, finishImport, listBooks, loadBookPage, startImport, storeChapter } from '~/server/user-books'
import { NO_DETAILS } from '~/shared/import/details'
import { sniffImage } from '~/shared/import/image'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { openLibraryStub, STUB_COVERS, STUB_TITLES } from '../../../stubs/open-library-stub'
import { spend } from '../../../support/server/quota'
import { testUser } from '../../../support/server/users'

const db = () => getDb()

const image = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/images/${name}`, import.meta.url)))
const coverOf = (name: string, source: 'epub' | 'upload' | 'open-library' = 'upload') => {
  const bytes = image(name)
  return newCover(bytes, sniffImage(bytes) as NonNullable<ReturnType<typeof sniffImage>>, source)
}

const DETAILS = { description: 'About it.', isbn: '9780141439518', publisher: 'Penguin', publishedYear: 2003 }
const META = { title: 'Field Notes', author: 'Ada', language: 'en', details: NO_DETAILS, chapterCount: 1 }

afterAll(async () => {
  await closeDb()
})

const newUser = (username: string) => testUser(db(), username, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

async function uploading(username: string, details = NO_DETAILS) {
  const user = await newUser(username)
  const start = await startImport(db(), user.id, { ...META, details }, new Date(), DEFAULT_LIMITS)
  if (!start.ok) throw new Error('could not start')
  const finish = async () => {
    await storeChapter(db(), user.id, start.id, 0, { title: 'Morning', pages: ['<p>one</p>'] }, DEFAULT_LIMITS)
    expect(await finishImport(db(), user.id, start.id, null)).toBe('ok')
  }
  return { user, bookId: start.id, finish }
}

async function ready(username: string, details = NO_DETAILS) {
  const book = await uploading(username, details)
  await book.finish()
  return book
}

describe('the store', () => {
  it('stores a cover on an uploading and a ready book, and a second replaces the first', async () => {
    const { user, bookId, finish } = await uploading('reader')
    expect(await setCover(db(), user.id, bookId, coverOf('cover.jpg', 'epub'))).toBe('ok')
    expect(await readCover(db(), user.id, bookId)).toBeNull()
    await finish()
    expect(await readCover(db(), user.id, bookId)).toEqual({ mediaType: 'image/jpeg', bytes: image('cover.jpg') })
    expect(await setCover(db(), user.id, bookId, coverOf('wide.png'))).toBe('ok')
    expect(await readCover(db(), user.id, bookId)).toEqual({ mediaType: 'image/png', bytes: image('wide.png') })
    const [row] = await raw<{ n: string }[]>`select count(*) as n from user_book_covers`
    expect(Number(row?.n)).toBe(1)
  })

  it('finds no book of another user', async () => {
    const { bookId } = await ready('reader')
    const other = await newUser('other')
    expect(await setCover(db(), other.id, bookId, coverOf('cover.jpg'))).toBe('missing')
    expect(await readCover(db(), other.id, bookId)).toBeNull()
    expect(await removeCover(db(), other.id, bookId)).toBe(false)
    expect(await saveDetails(db(), other.id, bookId, { title: 'x', author: 'y', ...DETAILS })).toBe('missing')
    expect(await applyMatch(db(), other.id, bookId, { work: 'OL1W' })).toBe('missing')
    expect(await loadBookPage(db(), other.id, bookId)).toBeNull()
  })

  it('removes a cover, and is true for the owner whether or not there was one', async () => {
    const { user, bookId } = await ready('reader')
    expect(await removeCover(db(), user.id, bookId)).toBe(true)
    await setCover(db(), user.id, bookId, coverOf('cover.jpg'))
    expect(await removeCover(db(), user.id, bookId)).toBe(true)
    expect(await readCover(db(), user.id, bookId)).toBeNull()
  })

  it('deletes the cover with the book', async () => {
    const { user, bookId } = await ready('reader')
    await setCover(db(), user.id, bookId, coverOf('cover.jpg'))
    expect(await deleteBook(db(), user.id, bookId)).toBe(true)
    const [row] = await raw<{ n: string }[]>`select count(*) as n from user_book_covers`
    expect(Number(row?.n)).toBe(0)
  })

  it('stores the details a start request carries, and lists and loads the cover’s facts but never its bytes', async () => {
    const { user, bookId } = await ready('reader', DETAILS)
    const cover = coverOf('cover.jpg', 'epub')
    await setCover(db(), user.id, bookId, cover)
    const facts = { width: 400, height: 600, sha256: cover.sha256, source: 'epub' }
    const [listed] = await listBooks(db(), user.id)
    expect(listed).toMatchObject({ id: bookId, details: DETAILS, cover: facts })
    expect(JSON.stringify(listed)).not.toContain('bytes')
    const page = await loadBookPage(db(), user.id, bookId)
    expect(page).toMatchObject({
      id: bookId,
      title: 'Field Notes',
      details: DETAILS,
      cover: facts,
      openLibraryWork: null,
      chapters: [{ slug: 'morning', title: 'Morning', pageCount: 1 }],
    })
    expect(page?.readyAt).toBeInstanceOf(Date)
    expect(Object.keys(page?.cover ?? {})).toEqual(['width', 'height', 'sha256', 'source'])
  })

  it('loads no page for an unfinished book or a bad id', async () => {
    const { user, bookId } = await uploading('reader')
    expect(await loadBookPage(db(), user.id, bookId)).toBeNull()
    expect(await loadBookPage(db(), user.id, 'not-a-uuid')).toBeNull()
    expect((await listBooks(db(), user.id)).length).toBe(0)
  })

  it('saves edited details, clearing the ones left empty', async () => {
    const { user, bookId } = await ready('reader', DETAILS)
    const edited = { title: 'New Title', author: 'New Author', ...NO_DETAILS, publisher: 'Mine' }
    expect(await saveDetails(db(), user.id, bookId, edited)).toEqual({
      changed: ['title', 'author', 'description', 'isbn', 'publisher', 'publishedYear'],
    })
    expect(await saveDetails(db(), user.id, bookId, edited)).toEqual({ changed: [] })
    expect(await loadBookPage(db(), user.id, bookId)).toMatchObject({
      title: 'New Title',
      author: 'New Author',
      details: { description: null, isbn: null, publisher: 'Mine', publishedYear: null },
    })
  })

  it('applies a match: the description and cover replace, the ISBN and year only fill empty ones', async () => {
    const { user, bookId } = await ready('reader', { ...NO_DETAILS, isbn: '9780141439518', description: 'Mine.' })
    const cover = coverOf('cover.jpg', 'open-library')
    const result = await applyMatch(db(), user.id, bookId, {
      work: 'OL66554W',
      description: 'From Open Library.',
      isbn: '9791090636071',
      publishedYear: 1813,
      cover,
    })
    expect(result).toEqual({ changed: { description: true, cover: true, isbn: false, year: true } })
    expect(await loadBookPage(db(), user.id, bookId)).toMatchObject({
      openLibraryWork: 'OL66554W',
      details: { description: 'From Open Library.', isbn: '9780141439518', publishedYear: 1813 },
      cover: { source: 'open-library', sha256: cover.sha256 },
    })
    expect(await applyMatch(db(), user.id, bookId, { work: 'OL66554W', publishedYear: 1900 })).toEqual({
      changed: { description: false, cover: false, isbn: false, year: false },
    })
    expect((await loadBookPage(db(), user.id, bookId))?.details.description).toBe('From Open Library.')
  })
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

async function signIn(userId: number) {
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId, ip: null, userAgent: 'test' })
  return `${cookieName}=${token}`
}

const upload = (
  cookie: string | null,
  id: string,
  bytes: Uint8Array<ArrayBuffer>,
  type = 'image/jpeg',
  query = '',
  extra = {},
) =>
  handleCoverUpload(
    new Request(`${origin}/account/books/${id}/cover${query}`, {
      method: 'POST',
      headers: { origin, 'content-type': type, ...(cookie ? { cookie } : {}), ...extra },
      body: bytes,
    }),
    id,
  )

const getCover = (cookie: string | null, id: string) =>
  handleCoverGet(new Request(`${origin}/account/books/${id}/cover`, { headers: cookie ? { cookie } : {} }), id)

const events = (event: string) =>
  raw<{ detail: Record<string, unknown> }[]>`select detail from audit_events where event = ${event} order by id`

describe('uploading a cover', () => {
  it('stores a checked image and audits book.cover_changed without the title', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const res = await upload(cookie, bookId, image('cover.jpg'), 'image/jpeg', '?source=epub')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const { cover } = (await res.json()) as { cover: { src: string; width: number; height: number; source: string } }
    expect(cover).toMatchObject({ width: 400, height: 600, source: 'epub' })
    expect(cover.src).toMatch(new RegExp(`^/account/books/${bookId}/cover\\?v=[0-9a-f]{8}$`))
    const [event] = await events('book.cover_changed')
    expect(event?.detail).toEqual({ bookId, source: 'epub' })
    expect(JSON.stringify(event)).not.toContain('Field Notes')
  })

  it('takes the type from the bytes: a PNG sent as image/jpeg is stored as a PNG', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    expect((await upload(cookie, bookId, image('wide.png'), 'image/jpeg')).status).toBe(200)
    expect((await readCover(db(), user.id, bookId))?.mediaType).toBe('image/png')
    expect((await events('book.cover_changed'))[0]?.detail).toEqual({ bookId, source: 'upload' })
  })

  it('is a 404 signed out, for another user’s book and for a bad id', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const other = await signIn((await newUser('other')).id)
    expect((await upload(null, bookId, image('cover.jpg'))).status).toBe(404)
    expect((await upload(other, bookId, image('cover.jpg'))).status).toBe(404)
    expect((await upload(cookie, 'not-a-uuid', image('cover.jpg'))).status).toBe(404)
    expect(await readCover(db(), user.id, bookId)).toBeNull()
  })

  it('refuses WebP (415), over 512 KB (413), a bad source, and no bytes or bytes that aren’t a cover (400 image)', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const answer = async (res: Response) => [res.status, await res.json()]
    const image415 = await upload(cookie, bookId, image('cover.jpg'), 'image/webp')
    expect(await answer(image415)).toEqual([415, { error: 'image', problem: 'type' }])
    expect(await answer(await upload(cookie, bookId, image('huge.jpg')))).toEqual([
      413,
      { error: 'image', problem: 'large' },
    ])
    const text = await upload(cookie, bookId, image('not-an-image.jpg'))
    expect(await answer(text)).toEqual([400, { error: 'image', problem: 'type' }])
    const empty = await upload(cookie, bookId, new Uint8Array(0))
    expect(await answer(empty)).toEqual([400, { error: 'image', problem: 'type' }])
    const tiny = await upload(cookie, bookId, image('tiny.png'), 'image/png')
    expect(await answer(tiny)).toEqual([400, { error: 'image', problem: 'small' }])
    const fromServer = await upload(cookie, bookId, image('cover.jpg'), 'image/jpeg', '?source=open-library')
    expect(fromServer.status).toBe(400)
    expect(await readCover(db(), user.id, bookId)).toBeNull()
    expect(await events('book.cover_changed')).toEqual([])
  })

  it('takes a cover for a book still uploading, as an import sends it first', async () => {
    const { user, bookId } = await uploading('reader')
    const cookie = await signIn(user.id)
    expect((await upload(cookie, bookId, image('cover.jpg'), 'image/jpeg', '?source=zip')).status).toBe(200)
  })

  it('takes a cover drawn from a PDF’s first page, and says where it came from', async () => {
    const { user, bookId } = await uploading('reader')
    const cookie = await signIn(user.id)
    const res = await upload(cookie, bookId, image('cover.jpg'), 'image/jpeg', '?source=pdf')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { cover: { source: string } }).cover.source).toBe('pdf')
  })
})

describe('reading a cover', () => {
  it('serves it to its owner with its type, nosniff, a sandboxing CSP and no-store', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    await upload(cookie, bookId, image('wide.png'), 'image/png')
    const res = await getCover(cookie, bookId)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(image('wide.png'))
  })

  it('is a 404 for another user, signed out, a bad id, a book without a cover and an unfinished book', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    expect((await getCover(cookie, bookId)).status).toBe(404)
    await upload(cookie, bookId, image('cover.jpg'))
    const other = await signIn((await newUser('other')).id)
    expect((await getCover(other, bookId)).status).toBe(404)
    expect((await getCover(null, bookId)).status).toBe(404)
    expect((await getCover(cookie, 'nope')).status).toBe(404)
    const draft = await uploading('writer')
    const writer = await signIn(draft.user.id)
    await upload(writer, draft.bookId, image('cover.jpg'))
    const res = await getCover(writer, draft.bookId)
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('answers 503 when the database fails, and logs it', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    await upload(cookie, bookId, image('wide.png'), 'image/png')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      const res = await getCover(cookie, bookId)
      expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control')]).toEqual([
        503,
        'text/plain',
        'private, no-store',
      ])
      expect(await res.text()).toBe('Unavailable')
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^\[book cover read\] /)])
    } finally {
      errors.mockRestore()
    }
  })
})

const broken = (() => {
  throw new Error('the database went away')
}) as unknown as Pool

describe('the book page’s form', () => {
  const post = (cookie: string | null, id: string, fields: Record<string, string>, headers = {}) =>
    handleBookForm(
      new Request(`${origin}/account/books/${id}`, {
        method: 'POST',
        headers: { origin, ...(cookie ? { cookie } : {}), ...headers },
        body: new URLSearchParams(fields),
      }),
      id,
    )
  const details = {
    intent: 'details',
    title: 'Field Notes',
    author: 'Ada',
    description: 'A <b>small</b> book.',
    isbn: '0141439513',
    publisher: 'Mine',
    year: '2020',
  }
  const location = (res: Response) => [res.status, res.headers.get('location')]

  it('saves details and audits the names of the fields that changed, never their values', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    expect(location(await post(cookie, bookId, details))).toEqual([303, `/account/books/${bookId}?status=saved`])
    expect(await loadBookPage(db(), user.id, bookId)).toMatchObject({
      details: { description: 'A small book.', isbn: '9780141439518', publisher: 'Mine', publishedYear: 2020 },
    })
    const [event] = await events('book.details_changed')
    expect(event?.detail).toEqual({ bookId, fields: ['description', 'isbn', 'publisher', 'publishedYear'] })
    expect(JSON.stringify(event)).not.toMatch(/small|9780141439518|Mine/)
    await post(cookie, bookId, details)
    expect(await events('book.details_changed')).toHaveLength(1)
  })

  it('goes back to the generated cover', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    await upload(cookie, bookId, image('cover.jpg'))
    const res = await post(cookie, bookId, { intent: 'remove-cover' })
    expect(location(res)).toEqual([303, `/account/books/${bookId}?status=cover-removed`])
    expect(await readCover(db(), user.id, bookId)).toBeNull()
    expect((await events('book.cover_changed')).at(-1)?.detail).toEqual({ bookId, source: 'generated' })
  })

  it('answers each problem with its error code', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const back = (code: string) => [303, `/account/books/${bookId}?error=${code}`]
    expect(location(await post(cookie, bookId, { ...details, title: '' }))).toEqual(back('invalid'))
    expect(location(await post(cookie, bookId, { ...details, isbn: '123' }))).toEqual(back('invalid-isbn'))
    expect(location(await post(cookie, bookId, { ...details, description: 'word '.repeat(801) }))).toEqual(
      back('too-long'),
    )
    const other = await ready('other')
    const missing = await post(cookie, other.bookId, details)
    expect(location(missing)).toEqual([303, `/account/books/${other.bookId}?error=missing`])
    const removeMissing = await post(cookie, other.bookId, { intent: 'remove-cover' })
    expect(location(removeMissing)).toEqual([303, `/account/books/${other.bookId}?error=missing`])
    expect((await loadBookPage(db(), other.user.id, other.bookId))?.details.isbn).toBeNull()
  })

  it('sends a signed-out visitor to sign in, and is a 404 for a bad id', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    expect(location(await post(null, bookId, details))).toEqual([
      303,
      `/login?next=${encodeURIComponent(`/account/books/${bookId}`)}`,
    ])
    expect((await post(cookie, 'not-a-uuid', details)).status).toBe(404)
  })
})

const OL = getConfig().openLibraryBase
const COVERS = getConfig().openLibraryCoversBase
const sent: string[] = []
const stubFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  sent.push(url)
  const stubUrl = url.startsWith(COVERS)
    ? `http://stub/covers${url.slice(COVERS.length)}`
    : url.startsWith(OL)
      ? `http://stub/api${url.slice(OL.length)}`
      : `http://stub/elsewhere/${encodeURIComponent(url)}`
  return openLibraryStub(new Request(stubUrl, init))
}) as typeof fetch

const lookupRequest = (cookie: string | null, body: unknown, headers = {}) =>
  new Request(`${origin}/account/books/lookup`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify(body),
  })
const lookup = (cookie: string | null, body: unknown, headers = {}) =>
  handleLookup(lookupRequest(cookie, body, headers), { fetch: stubFetch })
const apply = (cookie: string | null, id: string, body: unknown) =>
  handleApply(
    new Request(`${origin}/account/books/${id}/open-library`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    id,
    { fetch: stubFetch },
  )

interface Match {
  work: string
  title: string
  author: string | null
  year: number | null
  coverId: number | null
  thumb: string | null
}

describe('looking up a book', () => {
  beforeEach(() => {
    resetOpenLibrary()
    resetRecentSearches()
    sent.length = 0
  })

  it('searches by title and author, with thumbnails on the configured covers base, and audits no query', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const res = await lookup(cookie, { book: bookId, title: 'Pride and Prejudice', author: 'Austen', isbn: '' })
    expect(res.status).toBe(200)
    const { matches } = (await res.json()) as { matches: Match[] }
    expect(matches).toHaveLength(5)
    expect(matches[0]).toEqual({
      work: 'OL66554W',
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      year: 1813,
      coverId: 14348537,
      thumb: `${COVERS}/b/id/14348537-M.jpg`,
    })
    const query = new URL(sent[0] as string).searchParams
    expect([query.get('title'), query.get('author'), query.get('limit')]).toEqual([
      'Pride and Prejudice',
      'Austen',
      '5',
    ])
    const [event] = await events('book.looked_up')
    expect(event?.detail).toEqual({ bookId, kind: 'search', by: 'title', matches: 5 })
    expect(JSON.stringify(event)).not.toMatch(/Pride|Austen/)
  })

  it('searches by ISBN when one is given', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const res = await lookup(cookie, { book: bookId, title: 'Anything', isbn: '0-14-143951-3' })
    expect(((await res.json()) as { matches: Match[] }).matches.map((m) => m.work)).toEqual(['OL66554W'])
    expect(new URL(sent[0] as string).searchParams.get('q')).toBe('isbn:9780141439518')
    expect((await events('book.looked_up'))[0]?.detail).toMatchObject({ by: 'isbn', matches: 1 })
  })

  it('answers the cache for the same search, and says when nothing matches', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    await lookup(cookie, { book: bookId, title: 'Cached' })
    await lookup(cookie, { book: bookId, title: 'Cached' })
    expect(sent).toHaveLength(1)
    const none = await lookup(cookie, { book: bookId, title: STUB_TITLES.none })
    expect(await none.json()).toEqual({ matches: [] })
  })

  it('is 401 signed out, 404 for another user’s book or a bad one, and 400 for an empty query', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const other = await signIn((await newUser('other')).id)
    expect(await (await lookup(null, { book: bookId, title: 'x' })).json()).toEqual({ error: 'signed_out' })
    expect((await lookup(null, { book: bookId, title: 'x' })).status).toBe(401)
    expect((await lookup(other, { book: bookId, title: 'x' })).status).toBe(404)
    expect((await lookup(cookie, { book: 'nope', title: 'x' })).status).toBe(404)
    expect((await lookup(cookie, { title: 'x' })).status).toBe(404)
    expect((await lookup(cookie, { book: bookId, title: ' ', isbn: '' })).status).toBe(400)
    expect((await lookup(cookie, { book: bookId, title: 'x', extra: 1 })).status).toBe(400)
    expect(sent).toEqual([])
  })

  it('refuses the 31st lookup within an hour, with when to try again', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    await spend(db(), user.id, 'book-lookup', LOOKUP_LIMIT.max)
    const res = await lookup(cookie, { book: bookId, title: 'One more' })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string; retryAt: string }
    expect(body.error).toBe('rate')
    expect(new Date(body.retryAt).getTime()).toBeGreaterThan(Date.now())
    expect(sent).toEqual([])
  })

  it('answers Open Library’s errors in plain codes: 502 unavailable, 503 busy, and a redirect away fails', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const answer = async (title: string) => {
      resetOpenLibrary()
      const res = await lookup(cookie, { book: bookId, title })
      return [res.status, await res.json()]
    }
    expect(await answer(STUB_TITLES.error)).toEqual([502, { error: 'unavailable' }])
    expect(await answer(STUB_TITLES.busy)).toEqual([503, { error: 'busy' }])
    expect(await answer(STUB_TITLES.away)).toEqual([502, { error: 'unavailable' }])
    expect(sent.some((u) => u.includes('evil.example'))).toBe(false)
    expect((await events('book.looked_up')).map((e) => e.detail.problem)).toEqual([
      'unavailable',
      'busy',
      'unavailable',
    ])
  })
})

describe('applying a match', () => {
  beforeEach(() => {
    resetOpenLibrary()
    resetRecentSearches()
    sent.length = 0
  })

  const body = { work: 'OL66554W', coverId: 14348537, useCover: true, useDescription: true }

  it('applies the work’s description and the cover, fills the year from the search, and audits it', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    await lookup(cookie, { book: bookId, title: 'Pride and Prejudice' })
    resetOpenLibrary()
    const res = await apply(cookie, bookId, body)
    expect(res.status).toBe(200)
    const answer = (await res.json()) as { changed: Record<string, boolean>; cover: { src: string; source: string } }
    expect(answer.changed).toEqual({ description: true, cover: true, isbn: false, year: true })
    expect(answer.cover).toMatchObject({ width: 400, height: 600, source: 'open-library' })
    expect(sent.map((u) => new URL(u).pathname)).toEqual([
      '/search.json',
      '/works/OL66554W.json',
      '/b/id/14348537-L.jpg',
    ])
    const page = await loadBookPage(db(), user.id, bookId)
    expect(page?.details.description).toMatch(/^Pride and Prejudice is an 1813 novel/)
    expect(page).toMatchObject({ openLibraryWork: 'OL66554W', details: { publishedYear: 1813 } })
    expect(page?.cover).toMatchObject({ source: 'open-library', width: 400, height: 600 })
    expect((await events('book.looked_up')).at(-1)?.detail).toEqual({
      bookId,
      kind: 'apply',
      cover: true,
      description: true,
    })
    expect((await events('book.details_changed')).at(-1)?.detail).toEqual({
      bookId,
      fields: ['description', 'publishedYear'],
    })
    expect((await events('book.cover_changed')).at(-1)?.detail).toEqual({ bookId, source: 'open-library' })
  })

  it('fills an empty ISBN after an ISBN search, and keeps the cover with useCover false', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    await upload(cookie, bookId, image('wide.png'), 'image/png')
    await lookup(cookie, { book: bookId, isbn: '9780141439518' })
    resetOpenLibrary()
    const res = await apply(cookie, bookId, { ...body, useCover: false })
    expect(((await res.json()) as { changed: object }).changed).toEqual({
      description: true,
      cover: false,
      isbn: true,
      year: true,
    })
    const page = await loadBookPage(db(), user.id, bookId)
    expect(page?.cover?.source).toBe('upload')
    expect(page?.details.isbn).toBe('9780141439518')
    expect(sent.some((u) => u.includes('-L.jpg'))).toBe(false)
  })

  it('applies the description when the cover is over 512 KB, and says why the cover wasn’t', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const res = await apply(cookie, bookId, { ...body, coverId: STUB_COVERS.huge })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      coverProblem: 'cover-too-large',
      cover: null,
      changed: { description: true, year: false },
    })
    const page = await loadBookPage(db(), user.id, bookId)
    expect(page?.cover).toBeNull()
    expect(page?.details.publishedYear).toBeNull()
    expect((await events('book.looked_up')).at(-1)?.detail).toMatchObject({ problem: 'cover-too-large' })
  })

  it('follows a redirect within the covers host, and refuses one away from it', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const within = await apply(cookie, bookId, { ...body, coverId: STUB_COVERS.redirect, useDescription: false })
    expect(await within.json()).toMatchObject({ changed: { cover: true } })
    resetOpenLibrary()
    const away = await apply(cookie, bookId, { ...body, coverId: STUB_COVERS.away })
    expect(await away.json()).toMatchObject({ coverProblem: 'cover-failed' })
    const missing = await apply(cookie, bookId, { ...body, coverId: STUB_COVERS.missing })
    expect(await missing.json()).toMatchObject({ coverProblem: 'cover-failed' })
    expect(sent.some((u) => u.includes('evil.example'))).toBe(false)
  })

  it('is 502 when the work can’t be fetched and there is nothing else to apply', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const res = await apply(cookie, bookId, { work: 'OL404W', coverId: null, useCover: true, useDescription: true })
    expect([res.status, await res.json()]).toEqual([502, { error: 'unavailable' }])
    expect((await loadBookPage(db(), user.id, bookId))?.openLibraryWork).toBeNull()
  })

  it('refuses a work id that isn’t OL…W, another user’s book and a signed-out reader', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    const other = await signIn((await newUser('other')).id)
    expect((await apply(cookie, bookId, { ...body, work: '/works/OL66554W' })).status).toBe(400)
    expect((await apply(cookie, bookId, { ...body, description: 'mine' })).status).toBe(400)
    expect((await apply(other, bookId, body)).status).toBe(404)
    expect((await apply(cookie, 'nope', body)).status).toBe(404)
    expect((await apply(null, bookId, body)).status).toBe(401)
    expect(sent).toEqual([])
  })

  it('counts toward the 30 an hour', async () => {
    const { user, bookId } = await ready('reader')
    const cookie = await signIn(user.id)
    await spend(db(), user.id, 'book-lookup', LOOKUP_LIMIT.max)
    expect((await apply(cookie, bookId, body)).status).toBe(429)
  })
})

describe('Open Library pacing', () => {
  beforeEach(() => {
    resetOpenLibrary()
    sent.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts two requests at least a second apart, and answers busy past a 5 s queue', async () => {
    vi.useFakeTimers()
    const started: number[] = []
    const timed = ((input: RequestInfo | URL, init?: RequestInit) => {
      started.push(Date.now())
      return stubFetch(input, init)
    }) as typeof fetch
    const queries = Array.from({ length: 7 }, (_, i) =>
      search({ by: 'title', title: `Book ${i}`, author: '' }, { fetch: timed }),
    )
    await vi.advanceTimersByTimeAsync(7000)
    const results = await Promise.all(queries)
    expect(started.slice(1).map((t, i) => t - (started[i] as number))).toEqual([1000, 1000, 1000, 1000, 1000])
    expect(results.slice(0, 6).every((r) => r.ok)).toBe(true)
    expect(results[6]).toEqual({ ok: false, problem: 'busy' })
    expect(started).toHaveLength(6)
  })

  it('gives up on an answer after 8 s', async () => {
    vi.useFakeTimers()
    const pending = search({ by: 'title', title: STUB_TITLES.slow, author: '' }, { fetch: stubFetch })
    await vi.advanceTimersByTimeAsync(8000)
    expect(await pending).toEqual({ ok: false, problem: 'unavailable' })
  })

  it('names Folio and the site in its User-Agent', async () => {
    const seen: string[] = []
    const capture = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('user-agent') ?? '')
      return stubFetch(input, init)
    }) as typeof fetch
    await search({ by: 'title', title: 'Agent', author: '' }, { fetch: capture })
    expect(seen).toEqual([`Folio (+${getConfig().appOrigin})`])
  })
})
