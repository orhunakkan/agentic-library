import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { newCover, saveDetails, setCover } from '~/server/book-details/store'
import { newImage, storeImage } from '~/server/book-images/store'
import { openBook } from '~/server/books/book'
import { catalogueOfflineBook } from '~/server/books/offline'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { handleOfflineBook } from '~/server/downloads/handler'
import { catalogueVersion } from '~/server/downloads/version'
import { loadBook, loadCatalog } from '~/server/repository'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { finishImport, startImport, storeChapter } from '~/server/user-books'
import { privateBookSlug } from '~/shared/content/book-slug'
import { NO_DETAILS } from '~/shared/import/details'
import { sniffImage } from '~/shared/import/image'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { type OfflineBook, parseOfflineBook } from '~/shared/offline/book'
import { pictureUrls } from '~/shared/offline/pictures'
import { databaseUrl, freshDatabase } from '../testing/db'
import { testUser } from '../testing/users'

const failing = vi.hoisted(() => ({ owner: false }))
vi.mock('~/server/books/book', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/books/book')>()
  return {
    ...actual,
    openBook: (...args: Parameters<typeof actual.openBook>) =>
      failing.owner ? Promise.reject(new Error('connection lost')) : actual.openBook(...args),
  }
})

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const META = { title: 'Field Notes', author: 'Ada', language: 'en', details: NO_DETAILS, chapterCount: 2 }

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/images/${name}`, import.meta.url)))
const info = (bytes: Uint8Array) => sniffImage(bytes) as NonNullable<ReturnType<typeof sniffImage>>

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books restart identity cascade`
  failing.owner = false
})

async function account(username: string) {
  const user = await testUser(db(), username, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

async function book(userId: number, finish = true) {
  const picture = fixture('tiny.png')
  const start = await startImport(
    db(),
    userId,
    { ...META, images: { count: 1, bytes: picture.length } },
    new Date(),
    DEFAULT_LIMITS,
  )
  if (!start.ok) throw new Error('could not start')
  const src = `/account/books/${start.id}/images/1`
  const figure = `<figure><a href="${src}"><img src="${src}" alt="" width="1" height="1"></a></figure>`
  await storeChapter(db(), userId, start.id, 0, { title: 'Morning', pages: ['<p>dew</p>', figure] }, DEFAULT_LIMITS)
  await storeChapter(db(), userId, start.id, 1, { title: 'Evening', pages: ['<p>dusk</p>'] }, DEFAULT_LIMITS)
  const image = info(picture)
  await storeImage(
    db(),
    userId,
    start.id,
    1,
    newImage(picture, { ...image, type: image.type as 'image/png' }),
    DEFAULT_LIMITS,
  )
  if (finish) expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  return { id: start.id, slug: privateBookSlug(start.id), picture: src, pictureBytes: picture.length }
}

async function readerPage(userId: number, slug: string, part: string, n: string | undefined) {
  const book = await openBook(db(), userId, slug)
  if (book?.format !== 'text') throw new Error(`${slug} does not open as a text book`)
  const page = await book.readerPage(part, n)
  if (!page) throw new Error(`no reader page ${part}/${n ?? 1}`)
  return page
}

const request = (file: string, headers: Record<string, string> = {}) =>
  new Request(`${getConfig().appOrigin}/offline/${file}`, { headers })

async function download(slug: string, cookie?: string) {
  const response = await handleOfflineBook(request(`${slug}.json`, cookie ? { cookie } : {}), `${slug}.json`)
  return { response, book: response.ok ? parseOfflineBook(await response.json()) : null }
}

describe('a private book', () => {
  it('goes whole to its owner, with its owner, its pictures and its size, never stored', async () => {
    const owner = await account('owner')
    const { slug, picture, pictureBytes } = await book(owner.user.id)
    const { response, book: copy } = await download(slug, owner.cookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(copy).not.toBeNull()
    const got = copy as OfflineBook
    expect(got).toMatchObject({ v: 1, slug, title: 'Field Notes', author: 'Ada', owner: 'owner' })
    expect(got.content.chapters.map((c) => c.title)).toEqual(['Morning', 'Evening'])
    expect(got.content.kind === 'chapter' && got.content.chapters[0]?.pages).toHaveLength(2)
    expect(got.pictures).toEqual([picture])
    expect(got.speech).toMatchObject({ slug, chapterTitles: ['Morning', 'Evening'] })
    expect(got.bytes).toBeGreaterThan(pictureBytes)
  })

  it('is a 404 for another user, signed out and an unfinished upload', async () => {
    const owner = await account('owner')
    const other = await account('other')
    const { slug } = await book(owner.user.id)
    for (const cookie of [other.cookie, undefined, `${cookieName}=nope`]) {
      const { response } = await download(slug, cookie)
      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
    const unfinished = await book(owner.user.id, false)
    expect((await download(unfinished.slug, owner.cookie)).response.status).toBe(404)
    expect(
      (await download(privateBookSlug('00000000-0000-4000-8000-000000000000'), owner.cookie)).response.status,
    ).toBe(404)
  })

  it('refuses a cross-site request and a malformed file name', async () => {
    const owner = await account('owner')
    const { slug } = await book(owner.user.id)
    const crossSite = request(`${slug}.json`, { cookie: owner.cookie, 'sec-fetch-site': 'cross-site' })
    expect((await handleOfflineBook(crossSite, `${slug}.json`)).status).toBe(403)
    const sameSite = request(`${slug}.json`, { cookie: owner.cookie, 'sec-fetch-site': 'same-origin' })
    expect((await handleOfflineBook(sameSite, `${slug}.json`)).status).toBe(200)
    for (const file of [slug, `${slug}.txt`, '.json', 'u-nope.json', 'Bad.json', 'nav.json']) {
      expect((await handleOfflineBook(request(file, { cookie: owner.cookie }), file)).status, file).toBe(404)
    }
  })

  it('answers 500 failed, never stored, when the owner check fails for another reason than a 404', async () => {
    const owner = await account('owner')
    const { slug } = await book(owner.user.id)
    failing.owner = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { response } = await download(slug, owner.cookie)
      expect(response.status).toBe(500)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.json()).toEqual({ error: 'failed' })
      expect(error).toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })

  it('has a version that follows the details and the cover, and matches the reader page', async () => {
    const owner = await account('owner')
    const { id, slug } = await book(owner.user.id)
    const version = async () => (await download(slug, owner.cookie)).book?.version
    const first = await version()
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(await version()).toBe(first)

    expect((await readerPage(owner.user.id, slug, 'morning', undefined)).offlineVersion).toBe(first)
    expect((await readerPage(owner.user.id, slug, 'evening', undefined)).offlineVersion).toBe(first)

    await saveDetails(db(), owner.user.id, id, { ...NO_DETAILS, title: 'Field Notes, Revised', author: 'Ada' })
    const renamed = await version()
    expect(renamed).not.toBe(first)
    expect((await download(slug, owner.cookie)).book?.title).toBe('Field Notes, Revised')
    expect((await readerPage(owner.user.id, slug, 'morning', '2')).offlineVersion).toBe(renamed)

    const cover = fixture('cover.jpg')
    await setCover(db(), owner.user.id, id, newCover(cover, info(cover), 'upload'))
    const covered = await download(slug, owner.cookie)
    expect(covered.book?.version).not.toBe(renamed)
    expect(covered.book?.context.image?.src).toMatch(new RegExp(`^/account/books/${id}/cover\\?v=`))
    expect(covered.book?.bytes).toBeGreaterThan(cover.length)
    expect((await readerPage(owner.user.id, slug, 'morning', undefined)).offlineVersion).toBe(covered.book?.version)
  })
})

describe('a catalogue book', () => {
  it('goes to anyone, sent no-cache, with every picture and its version', async () => {
    const { books } = await loadCatalog()
    const meta = books[0]
    if (!meta) throw new Error('the catalogue is empty')
    const { response, book: copy } = await download(meta.slug)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(copy).toMatchObject({ v: 1, slug: meta.slug, title: meta.title, owner: null })
    const content = await loadBook(meta.slug)
    if (!content) throw new Error('no content')
    expect(copy?.pictures).toEqual(pictureUrls(content))
    expect(copy?.context.catalog.books).toEqual([meta])
    expect(copy?.bytes).toBeGreaterThan(JSON.stringify(content).length)
    expect(await catalogueVersion(meta.slug)).toBe(copy?.version)
    expect(await catalogueOfflineBook(meta.slug)).toBe(await catalogueOfflineBook(meta.slug))
  })

  it('is a 404 for a book that isn’t in the catalogue', async () => {
    expect((await download('no-such-book')).response.status).toBe(404)
    expect(await catalogueVersion('no-such-book')).toBeNull()
  })
})
