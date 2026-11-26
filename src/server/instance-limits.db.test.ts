import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/** What getConfig answers with, which each test sets: every cap's value travels from here to a refusal. */
const configured = vi.hoisted(() => ({
  limits: undefined as InstanceLimits | undefined,
  audiobooksDir: undefined as string | undefined,
}))

vi.mock('./config.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config.ts')>()
  const parsed = actual.parseConfig(process.env)
  return {
    ...actual,
    getConfig: () => ({
      ...parsed,
      limits: configured.limits ?? parsed.limits,
      audiobooksDir: configured.audiobooksDir ?? parsed.audiobooksDir,
    }),
  }
})

import { accountStorage } from '~/server/account-storage'
import { articlesState } from '~/server/articles/actions'
import { hold } from '~/server/articles/pending'
import { handleNewAudiobook } from '~/server/audiobooks/actions'
import { handleChapter, handleNewBook } from '~/server/book-actions'
import { handleImage } from '~/server/book-images/actions'
import { newImage, storeImage } from '~/server/book-images/store'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { startImport, storeChapter } from '~/server/user-books'
import { GB } from '~/shared/audiobooks/limits'
import { NO_DETAILS } from '~/shared/import/details'
import { MAX_BOOK_HTML_BYTES } from '~/shared/import/limits'
import { DEFAULT_LIMITS, type InstanceLimits } from '~/shared/limits/limits'
import { databaseUrl, freshDatabase } from './testing/db'
import { testUser } from './testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const META = { title: 'Limits', author: 'Ada', language: 'en', details: NO_DETAILS, chapterCount: 1 }
const BODY = { title: 'Limits', author: 'Ada', language: 'en', chapterCount: 1 }
const audioRoot = mkdtempSync(join(tmpdir(), 'instance-limits-'))

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
  rmSync(audioRoot, { recursive: true, force: true })
})
beforeEach(async () => {
  await raw`truncate users, sessions, audit_events, user_books restart identity cascade`
  configured.limits = { ...DEFAULT_LIMITS }
  configured.audiobooksDir = audioRoot
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

async function signedIn(username = 'reader') {
  const user = await testUser(db(), username, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

const post = (cookie: string, body: unknown) =>
  new Request(`${origin}/account/books/x`, {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const answer = async (response: Response) => [response.status, await response.json()]

/** The start of an M4B audiobook of `bytes`, as the browser sends it. */
const audiobookBody = (bytes = 1000) => ({
  title: 'Heard',
  author: 'Ada',
  narrator: null,
  language: 'en',
  details: { description: null, isbn: null, publisher: null, publishedYear: null },
  files: [{ type: 'mp4', bytes }],
  chapters: [{ title: 'One', fileN: 1, startMs: 0, durationMs: 3000 }],
  cover: false,
})
const roomy = { freeBytes: async () => 100 * GB }
const startAudiobookAs = (cookie: string, bytes?: number) =>
  handleNewAudiobook(post(cookie, audiobookBody(bytes)), roomy)

/** A chapter of one paragraph that renders to exactly `bytes` of HTML: `<p>`, the text and `</p>`. */
const paragraphOf = (bytes: number) => ({
  title: 'Only',
  blocks: [{ type: 'paragraph', runs: [{ text: 'x'.repeat(bytes - '<p></p>'.length) }] }],
})

describe('LIMIT_ARTICLE_TEXT', () => {
  const startArticle = async (userId: number, url: string) => {
    const start = await startImport(db(), userId, META, new Date(), DEFAULT_LIMITS, { url })
    if (!start.ok) throw new Error('could not start')
    return start.id
  }

  it('reaches the chapter upload: an article at the configured cap is stored, and one over it is refused with it', async () => {
    configured.limits = { ...DEFAULT_LIMITS, articleTextBytes: 2000 }
    const { user, cookie } = await signedIn()
    const fits = await startArticle(user.id, 'https://a.test/fits')
    expect(await answer(await handleChapter(post(cookie, paragraphOf(2000)), fits, '0'))).toEqual([200, { ok: true }])
    const over = await startArticle(user.id, 'https://a.test/over')
    expect(await answer(await handleChapter(post(cookie, paragraphOf(2001)), over, '0'))).toEqual([
      413,
      { error: 'article-too-large', max: 2000 },
    ])
    expect(await raw`select 1 from user_books where id = ${over}`).toHaveLength(0)
  })

  it('leaves books to the 8 MB book cap, which still answers book-too-large', async () => {
    configured.limits = { ...DEFAULT_LIMITS, articleTextBytes: 2000 }
    const { user, cookie } = await signedIn()
    const start = await startImport(db(), user.id, { ...META, chapterCount: 2 }, new Date(), DEFAULT_LIMITS)
    if (!start.ok) throw new Error('could not start')
    const nearlyFull = { title: 'Long', pages: ['x'.repeat(MAX_BOOK_HTML_BYTES - 1000)] }
    expect(await storeChapter(db(), user.id, start.id, 0, nearlyFull, DEFAULT_LIMITS)).toBe('ok')
    expect(await answer(await handleChapter(post(cookie, paragraphOf(1000)), start.id, '1'))).toEqual([
      200,
      { ok: true },
    ])
    expect(await answer(await handleChapter(post(cookie, paragraphOf(1001)), start.id, '1'))).toEqual([
      413,
      { error: 'book-too-large' },
    ])
  })
})

describe('LIMIT_BOOKS', () => {
  it('reaches the book and audiobook starts, which refuse past the configured count with it', async () => {
    configured.limits = { ...DEFAULT_LIMITS, books: 2 }
    const { cookie } = await signedIn()
    expect((await handleNewBook(post(cookie, BODY))).status).toBe(201)
    expect((await startAudiobookAs(cookie)).status).toBe(201)
    const refused = [409, { error: 'quota', scope: 'books', max: 2 }]
    expect(await answer(await handleNewBook(post(cookie, BODY)))).toEqual(refused)
    expect(await answer(await startAudiobookAs(cookie))).toEqual(refused)
  })
})

describe('LIMIT_ARTICLES', () => {
  it('reaches the article start, which refuses past the configured count with it, and the Articles page', async () => {
    configured.limits = { ...DEFAULT_LIMITS, articles: 1 }
    const { user, cookie } = await signedIn()
    const save = (url: string) => handleNewBook(post(cookie, { ...BODY, article: hold(user.id, url, []) }))
    expect((await save('https://a.test/one')).status).toBe(201)
    expect(await answer(await save('https://a.test/two'))).toEqual([409, { error: 'quota', scope: 'articles', max: 1 }])
    const state = await articlesState(new Request(`${origin}/account/articles`, { headers: { cookie } }))
    expect(state).toMatchObject({ state: 'ready', max: 1, limits: configured.limits })
  })
})

describe('LIMIT_USER_PICTURES', () => {
  const picture = new Uint8Array(readFileSync(new URL('../../tests/fixtures/images/wide.png', import.meta.url)))
  const uploadPicture = (cookie: string, id: string) =>
    handleImage(
      new Request(`${origin}/account/books/${id}/images/1`, {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'image/png' },
        body: picture,
      }),
      id,
      '1',
    )

  it('reaches the start, which refuses pictures past the configured room with it', async () => {
    configured.limits = { ...DEFAULT_LIMITS, userPictureBytes: 5000 }
    const { cookie } = await signedIn()
    const fits = await handleNewBook(post(cookie, { ...BODY, images: { count: 1, bytes: 5000 } }))
    expect(await answer(fits)).toEqual([201, { id: expect.any(String), imageBytesLeft: 0 }])
    expect(await answer(await handleNewBook(post(cookie, { ...BODY, images: { count: 1, bytes: 5001 } })))).toEqual([
      409,
      { error: 'quota', scope: 'user', max: 5000 },
    ])
  })

  it('reaches the picture upload, which refuses a picture past the configured room with it', async () => {
    const { user, cookie } = await signedIn()
    const images = { count: 1, bytes: picture.length }
    const start = await startImport(db(), user.id, { ...META, images }, new Date(), DEFAULT_LIMITS)
    if (!start.ok) throw new Error('could not start')
    configured.limits = { ...DEFAULT_LIMITS, userPictureBytes: picture.length - 1 }
    expect(await answer(await uploadPicture(cookie, start.id))).toEqual([
      409,
      { error: 'quota', scope: 'user', max: picture.length - 1 },
    ])
    configured.limits = { ...DEFAULT_LIMITS, userPictureBytes: picture.length }
    expect((await uploadPicture(cookie, start.id)).status).toBe(200)
  })
})

describe('LIMIT_AUDIOBOOK_SIZE', () => {
  it('reaches the audiobook start’s parser: one at the configured size gets past it, one byte more is refused', async () => {
    configured.limits = { ...DEFAULT_LIMITS, audiobookBytes: 1000 }
    const { cookie } = await signedIn()
    expect(await answer(await startAudiobookAs(cookie, 1001))).toEqual([400, { error: 'invalid' }])
    expect((await startAudiobookAs(cookie, 1000)).status).toBe(201)
  })
})

describe('LIMIT_USER_AUDIO', () => {
  it('reaches the audiobook start, which refuses audio past the configured total with it', async () => {
    configured.limits = { ...DEFAULT_LIMITS, userAudioBytes: 3000, audiobookBytes: 2000 }
    const { cookie } = await signedIn()
    expect((await startAudiobookAs(cookie, 2000)).status).toBe(201)
    expect(await answer(await startAudiobookAs(cookie, 1001))).toEqual([
      409,
      { error: 'quota', scope: 'audio', max: 3000 },
    ])
    expect((await startAudiobookAs(cookie, 1000)).status).toBe(201)
  })
})

describe('the account page’s storage', () => {
  it('counts what the reader holds, beside the configured limits, and whether audiobooks are on', async () => {
    configured.limits = { ...DEFAULT_LIMITS, userAudioBytes: GB, audiobookBytes: GB, userPictureBytes: 100 * 1024 ** 2 }
    const { user, cookie } = await signedIn()
    expect(await accountStorage(db(), user.id)).toEqual({
      bookCount: 0,
      articleCount: 0,
      audioBytes: 0,
      pictureBytes: 0,
      audiobooks: true,
      limits: configured.limits,
    })
    expect((await handleNewBook(post(cookie, BODY))).status).toBe(201)
    expect((await startAudiobookAs(cookie, 2000)).status).toBe(201)
    await startImport(db(), user.id, META, new Date(), DEFAULT_LIMITS, { url: 'https://a.test/one' })
    const pictured = await startImport(
      db(),
      user.id,
      { ...META, images: { count: 1, bytes: 700 } },
      new Date(),
      DEFAULT_LIMITS,
    )
    if (!pictured.ok) throw new Error('could not start')
    const picture = newImage(new Uint8Array(700), { type: 'image/png', width: 10, height: 10 })
    expect(await storeImage(db(), user.id, pictured.id, 1, picture, DEFAULT_LIMITS)).toBe('ok')
    expect(await accountStorage(db(), user.id)).toMatchObject({
      bookCount: 3,
      articleCount: 1,
      audioBytes: 2000,
      pictureBytes: 700,
    })
    configured.audiobooksDir = undefined
    expect(await accountStorage(db(), user.id)).toMatchObject({ audiobooks: false })
  })
})
