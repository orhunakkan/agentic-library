import { readFileSync } from 'node:fs'
import { isNotFound } from '@tanstack/react-router'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { newCover, setCover } from '~/server/book-details/store'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { privateBookSearch, privateReaderPage, privateSpeechChapter } from '~/server/private-reading'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { finishImport, startImport, storeChapter } from '~/server/user-books'
import { privateBookSlug } from '~/shared/content/book-slug'
import { NO_DETAILS } from '../shared/import/details.ts'
import { sniffImage } from '../shared/import/image.ts'
import { databaseUrl, freshDatabase } from './testing/db'
import { testUser } from './testing/users'

const current = vi.hoisted(() => ({ request: undefined as Request | undefined }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => {
    if (!current.request) throw new Error('no request set')
    return current.request
  },
}))

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const META = { title: 'Field Notes', author: 'Ada', language: 'en', details: NO_DETAILS, chapterCount: 2 }

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books restart identity cascade`
  current.request = undefined
})

async function account(username: string) {
  const user = await testUser(db(), username, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

async function book(userId: number, finish = true) {
  const start = await startImport(db(), userId, META)
  if (!start.ok) throw new Error('could not start')
  await storeChapter(db(), userId, start.id, 0, { title: 'Morning', pages: ['<p>dew on the grass</p>', '<p>two</p>'] })
  if (finish) {
    await storeChapter(db(), userId, start.id, 1, { title: 'Evening', pages: ['<p>the grass at dusk</p>'] })
    expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  }
  return privateBookSlug(start.id)
}

function as(cookie?: string) {
  current.request = new Request(`${getConfig().appOrigin}/read/x`, { headers: cookie ? { cookie } : {} })
}

describe('privateReaderPage', () => {
  it('shows the owner their book, page by page', async () => {
    const owner = await account('owner')
    const slug = await book(owner.user.id)
    as(owner.cookie)
    const first = await privateReaderPage(slug, 'morning', undefined)
    expect(first.view.book).toMatchObject({ slug, title: 'Field Notes', author: 'Ada' })
    expect(first.view.chapterTitle).toBe('Morning')
    expect(first.view.page).toEqual({ kind: 'chapter', html: '<p>dew on the grass</p>' })
    expect(first.audio).toBeNull()
    const second = await privateReaderPage(slug, 'morning', '2')
    expect(second.view.page).toEqual({ kind: 'chapter', html: '<p>two</p>' })
    expect((await privateReaderPage(slug, 'evening', undefined)).view.chapterTitle).toBe('Evening')
    const id = slug.slice(2)
    expect(first.view.book.href).toBe(`/account/books/${id}`)
    expect(first.view.book.coverUrl).toMatch(/^data:image\/svg\+xml/)
    const bytes = new Uint8Array(readFileSync(new URL('../../tests/fixtures/images/cover.jpg', import.meta.url)))
    const info = sniffImage(bytes) as NonNullable<ReturnType<typeof sniffImage>>
    await setCover(db(), owner.user.id, id, newCover(bytes, info, 'upload'))
    const covered = await privateReaderPage(slug, 'morning', undefined)
    expect(covered.view.book.coverUrl).toMatch(new RegExp(`^/account/books/${id}/cover\\?v=[0-9a-f]{8}$`))
    expect(covered.view.book.image).toMatchObject({ width: 400, height: 600 })
    expect((await privateSpeechChapter(slug, 0)).book.image?.src).toBe(covered.view.book.coverUrl)
  })

  it("is a 404 for another user's book", async () => {
    const owner = await account('owner')
    const other = await account('other')
    const slug = await book(owner.user.id)
    as(other.cookie)
    await expect(privateReaderPage(slug, 'morning', undefined)).rejects.toSatisfy(isNotFound)
  })

  it('is a 404 without a session, or with an ended one', async () => {
    const owner = await account('owner')
    const slug = await book(owner.user.id)
    as()
    await expect(privateReaderPage(slug, 'morning', undefined)).rejects.toSatisfy(isNotFound)
    await raw`update sessions set expires_at = now() - interval '1 second'`
    as(owner.cookie)
    await expect(privateReaderPage(slug, 'morning', undefined)).rejects.toSatisfy(isNotFound)
  })

  it('is a 404 for an upload that is not finished, even for its owner', async () => {
    const owner = await account('owner')
    const slug = await book(owner.user.id, false)
    as(owner.cookie)
    await expect(privateReaderPage(slug, 'morning', undefined)).rejects.toSatisfy(isNotFound)
  })

  it.each([
    ['no u- prefix', (slug: string) => slug.slice(2)],
    ['not a uuid', () => 'u-not-a-uuid'],
    ['upper-case hex', (slug: string) => slug.toUpperCase().replace(/^U-/, 'u-')],
    ['a trailing extra', (slug: string) => `${slug}0`],
    ['just the prefix', () => 'u-'],
  ])('is a 404 for a malformed slug: %s', async (_name, mangle) => {
    const owner = await account('owner')
    const slug = await book(owner.user.id)
    as(owner.cookie)
    await expect(privateReaderPage(mangle(slug), 'morning', undefined)).rejects.toSatisfy(isNotFound)
  })

  it.each([
    ['page 1 spelled out (page one has no number)', 'morning', '1'],
    ['page 0', 'morning', '0'],
    ['a leading zero', 'morning', '02'],
    ['past the last page', 'morning', '3'],
    ['far past any chapter', 'morning', '100001'],
    ['not a number', 'morning', 'two'],
    ['a chapter that is not there', 'midnight', undefined],
  ])('is a 404 for %s', async (_name, part, n) => {
    const owner = await account('owner')
    const slug = await book(owner.user.id)
    as(owner.cookie)
    await expect(privateReaderPage(slug, part, n)).rejects.toSatisfy(isNotFound)
  })
})

describe('privateBookSearch', () => {
  it('searches the owner’s book', async () => {
    const owner = await account('owner')
    const slug = await book(owner.user.id)
    as(owner.cookie)
    const hits = await privateBookSearch(slug, 'grass')
    expect(hits.map((h) => h.chapterTitle)).toEqual(['Morning', 'Evening'])
  })

  it('is a 404 for another user, no session, an unfinished upload and a malformed slug', async () => {
    const owner = await account('owner')
    const other = await account('other')
    const slug = await book(owner.user.id)
    const draft = await book(owner.user.id, false)
    as(other.cookie)
    await expect(privateBookSearch(slug, 'grass')).rejects.toSatisfy(isNotFound)
    as()
    await expect(privateBookSearch(slug, 'grass')).rejects.toSatisfy(isNotFound)
    as(owner.cookie)
    await expect(privateBookSearch(draft, 'grass')).rejects.toSatisfy(isNotFound)
    await expect(privateBookSearch('u-nope', 'grass')).rejects.toSatisfy(isNotFound)
  })
})

describe('privateSpeechChapter', () => {
  it('gives the owner one chapter to read aloud, with the book as the dock shows it', async () => {
    const owner = await account('owner')
    const slug = await book(owner.user.id)
    as(owner.cookie)
    const first = await privateSpeechChapter(slug, 0)
    expect(first.book).toMatchObject({
      slug,
      title: 'Field Notes',
      author: 'Ada',
      language: 'en',
      href: `/account/books/${slug.slice(2)}`,
      chapterTitles: ['Morning', 'Evening'],
    })
    expect(first.book.coverUrl).toMatch(/^data:image\/svg\+xml/)
    expect(first.chapter).toMatchObject({ index: 0, slug: 'morning', title: 'Morning', number: 1, chapterCount: 2 })
    expect(first.chapter.pages.map((p) => [p.href, p.label, p.text])).toEqual([
      [`/read/${slug}/morning`, 'Ch. 1 · p. 1', 'dew on the grass'],
      [`/read/${slug}/morning/2`, 'Ch. 1 · p. 2', 'two'],
    ])
    expect(first.chapter.pages[0]?.blocks).toEqual([{ start: 0, end: 16, kind: 'text' }])
    const second = await privateSpeechChapter(slug, 1)
    expect(second.chapter).toMatchObject({ index: 1, slug: 'evening', number: 2 })
    expect(second.chapter.pages.map((p) => p.text)).toEqual(['the grass at dusk'])
  })

  it("is a 404 for another user's book, no session, an ended session and an unfinished upload", async () => {
    const owner = await account('owner')
    const other = await account('other')
    const slug = await book(owner.user.id)
    const draft = await book(owner.user.id, false)
    as(other.cookie)
    await expect(privateSpeechChapter(slug, 0)).rejects.toSatisfy(isNotFound)
    as()
    await expect(privateSpeechChapter(slug, 0)).rejects.toSatisfy(isNotFound)
    as(owner.cookie)
    await expect(privateSpeechChapter(draft, 0)).rejects.toSatisfy(isNotFound)
    await raw`update sessions set expires_at = now() - interval '1 second'`
    as(owner.cookie)
    await expect(privateSpeechChapter(slug, 0)).rejects.toSatisfy(isNotFound)
  })

  it.each([
    ['past the last chapter', 2],
    ['far past any chapter', 100_000],
    ['negative', -1],
    ['not a whole number', 0.5],
  ])('is a 404 for a chapter %s', async (_name, chapter) => {
    const owner = await account('owner')
    const slug = await book(owner.user.id)
    as(owner.cookie)
    await expect(privateSpeechChapter(slug, chapter)).rejects.toSatisfy(isNotFound)
  })

  it('is a 404 for a malformed slug', async () => {
    const owner = await account('owner')
    await book(owner.user.id)
    as(owner.cookie)
    await expect(privateSpeechChapter('u-nope', 0)).rejects.toSatisfy(isNotFound)
  })
})
