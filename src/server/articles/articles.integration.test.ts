import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, vi } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { it, raw } from '../testing/db-test'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { readAccount } from '~/server/account-data/store'
import { handleChapter, handleFinish, handleNewBook } from '~/server/book-actions'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import {
  countedArticles,
  countedBooks,
  finishImport,
  listArticles,
  listBooks,
  loadBookPage,
  startImport,
  storeChapter,
} from '~/server/user-books'
import { NO_DETAILS } from '~/shared/import/details'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { ARTICLE_FETCH_LIMIT, ARTICLE_PICTURE_LIMIT, ARTICLE_SAVE_LIMIT, IMPORT_LIMIT } from '../rate-limit'
import { testUser } from '../testing/users'
import { articlesState, handleArticleFetch, handleArticlePicture, handleArticlesForm, myArticlesState } from './actions'
import type { ResolvedAddress } from './address-guard'
import { enter, IN_FLIGHT_MAX, resetPacing, takeFetch } from './pacing'
import { find, hold, PENDING_TTL_MS, resetPending } from './pending'
import type { WebFetchOptions } from './web-fetch'

type Handler = (req: IncomingMessage, res: ServerResponse) => void
const routes = new Map<string, Handler>()
let server: Server
let port = 0

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000020000000200802000000fc18eda30000001d49444154789cedc1010d000000c2a0f74f6d0e37a00000000000000000be0d210000014e5b0e5f0000000049454e44ae426082',
  'hex',
)
const ARTICLE_HTML = `<!doctype html><html lang="en"><head><title>A long read</title></head><body>
  <nav>menu</nav><article><h1>A long read</h1><p>${'Words of the article. '.repeat(40)}</p>
  <img src="/p.png" srcset="/p-800.png 800w"><img data-src="lazy.png"></article></body></html>`

const db = () => getDb()

beforeAll(async () => {
  server = createServer((req, res) => {
    const handler =
      routes.get(new URL(req.url ?? '/', 'http://x').pathname) ??
      ((_q: IncomingMessage, r: ServerResponse) => r.writeHead(404).end())
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeDb()
})
beforeEach(async () => {
  resetPacing()
  resetPending()
  routes.clear()
  routes.set('/article', (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(ARTICLE_HTML))
  routes.set('/p.png', (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG))
})

const WEB: WebFetchOptions = {
  resolve: async (): Promise<ResolvedAddress[]> => [{ address: '93.184.216.34', family: 4 }],
  connect: () => ({ address: '127.0.0.1', family: 4, port }),
}

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

let users = 0
/** A plain member: no grant and no subscription, so the limits here are every account's. */
async function signedIn() {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

const post = (path: string, cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const get = (cookie: string | null) => new Request(`${origin}/account/articles`, { headers: cookie ? { cookie } : {} })

const fetchArticle = (cookie: string | null, url: unknown, headers: Record<string, string> = {}) =>
  handleArticleFetch(post('/account/articles/fetch', cookie, { url }, headers), WEB)
const fetchPicture = (cookie: string | null, fetch: string, url: string) =>
  handleArticlePicture(post('/account/articles/picture', cookie, { fetch, url }), WEB)

const answer = async (response: Response) => [
  response.status,
  response.status === 403 ? null : (((await response.json()) as { error?: string }).error ?? null),
]

async function fetched(cookie: string, url = 'http://news.test/article') {
  const response = await fetchArticle(cookie, url)
  expect(response.status).toBe(200)
  return (await response.json()) as { fetch: string; finalUrl: string; html: string }
}

const META = { title: 'A long read', author: 'news.test', language: 'en', chapterCount: 1 }
const CHAPTER = { title: 'A long read', blocks: [{ type: 'paragraph', runs: [{ text: 'One two three four.' }] }] }
const start = (cookie: string, body: object) => handleNewBook(post('/account/books/new', cookie, body))

async function saved(cookie: string, url = 'http://news.test/article') {
  const { fetch } = await fetched(cookie, url)
  const started = await start(cookie, { ...META, article: fetch })
  expect(started.status).toBe(201)
  const { id } = (await started.json()) as { id: string }
  const chapter = await handleChapter(post(`/account/books/${id}/chapters/0`, cookie, CHAPTER), id, '0')
  expect(chapter.status).toBe(200)
  expect((await handleFinish(post(`/account/books/${id}/finish`, cookie, {}), id)).status).toBe(200)
  return id
}

async function fillArticles(userId: number, count: number) {
  await raw`
    insert into user_books (user_id, title, author, language, chapter_count, status, ready_at, article_url)
    select ${userId}, 'Filler', 'a', 'en', 1, 'ready', now(), 'https://filler.test/' || n
    from generate_series(1, ${count}) n`
}

describe('the table', () => {
  it('checks the address’s length, the words’ range, and that an article is never an audiobook', async () => {
    const { user } = await signedIn()
    const insert = (url: string, words: number | null, format: string | null) => raw`
      insert into user_books (user_id, title, author, language, chapter_count, article_url, article_words, format)
      values (${user.id}, 't', 'a', 'en', 1, ${url}, ${words}, ${format})`
    await expect(insert('', null, null)).rejects.toThrow(/check/)
    await expect(insert('x'.repeat(2001), null, null)).rejects.toThrow(/check/)
    await expect(insert('https://a.test/', -1, null)).rejects.toThrow(/check/)
    await expect(insert('https://a.test/', 10_000_001, null)).rejects.toThrow(/check/)
    await expect(insert('https://a.test/', null, 'audio')).rejects.toThrow(/user_books_article_not_audio/)
    await insert('https://a.test/', 5, null)
  })
})

describe('POST /account/articles/fetch', () => {
  it('fetches the page, holds it, and answers its HTML and final address', async () => {
    const { user, cookie } = await signedIn()
    routes.set('/go', (_req, res) => res.writeHead(301, { location: '/article?utm_source=x#top' }).end())
    const body = await fetched(cookie, 'http://news.test/go')
    expect(body.finalUrl).toBe('http://news.test/article?utm_source=x#top')
    expect(body.html).toContain('Words of the article.')
    const pending = find(user.id, body.fetch)
    expect(pending?.url).toBe('http://news.test/article')
    expect([...(pending?.pictures ?? [])]).toEqual([
      'http://news.test/p.png',
      'http://news.test/p-800.png',
      'http://news.test/lazy.png',
    ])
  })

  it('answers each refused address with its reason, before any request', async () => {
    const { cookie } = await signedIn()
    const cases: [string, string][] = [
      ['', 'empty'],
      [`https://a.test/${'x'.repeat(2000)}`, 'too_long'],
      ['not a url', 'not_url'],
      ['ftp://a.test/', 'scheme'],
      ['https://a.test:8080/', 'port'],
      ['https://u:p@a.test/', 'credentials'],
      ['http://localhost/x', 'private_host'],
      ['http://169.254.169.254/', 'private_host'],
      ['https://dev.agenticlibrary.app/library', 'own_site'],
    ]
    for (const [url, reason] of cases) {
      const response = await fetchArticle(cookie, url)
      expect([response.status, await response.json()], url).toEqual([400, { error: 'invalid', reason }])
    }
  })

  it('refuses a redirect inside, and says what the site answered', async () => {
    const { cookie } = await signedIn()
    routes.set('/inside', (_req, res) => res.writeHead(302, { location: 'http://127.0.0.1:5432/' }).end())
    routes.set('/forbidden', (_req, res) => res.writeHead(403).end())
    routes.set('/broken', (_req, res) => res.writeHead(500).end())
    routes.set('/pdf', (_req, res) => res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF'))
    routes.set('/huge', (_req, res) =>
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(6 * 1024 * 1024) }).end(),
    )
    routes.set('/loop', (_req, res) => res.writeHead(302, { location: '/loop' }).end())
    const cases: [string, number, string][] = [
      ['/inside', 422, 'blocked'],
      ['/missing', 404, 'page_not_found'],
      ['/forbidden', 422, 'refused'],
      ['/broken', 502, 'unavailable'],
      ['/pdf', 422, 'not_html'],
      ['/huge', 413, 'too_large'],
      ['/loop', 422, 'too_many_redirects'],
    ]
    for (const [path, status, error] of cases)
      expect(await answer(await fetchArticle(cookie, `http://news.test${path}`)), path).toEqual([status, error])
  })

  it('logs a failure without its address or host', async () => {
    const { cookie } = await signedIn()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    routes.set('/secret-path', (_req, res) => res.writeHead(500).end())
    await fetchArticle(cookie, 'http://private-site.test/secret-path')
    const lines = logged.mock.calls.flat().join('\n')
    expect(lines).toContain('unavailable (500)')
    expect(lines).not.toMatch(/private-site|secret-path/)
  })

  it('holds a reader to 60 fetches an hour, and the server to 4 at once', async () => {
    const { user, cookie } = await signedIn()
    for (let i = 0; i < ARTICLE_FETCH_LIMIT.max; i++) takeFetch('page', user.id)
    const limited = await fetchArticle(cookie, 'http://news.test/article')
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ error: 'limited', retryAt: expect.any(String) })
    resetPacing()
    const held = Array.from({ length: IN_FLIGHT_MAX.page }, () => enter('page'))
    expect(await answer(await fetchArticle(cookie, 'http://news.test/article'))).toEqual([503, 'busy'])
    for (const release of held) release?.()
    expect((await fetchArticle(cookie, 'http://news.test/article')).status).toBe(200)
  })

  it('says an article is saved already, by the address typed or the one it redirects to', async () => {
    const { cookie } = await signedIn()
    const id = await saved(cookie)
    const typed = await fetchArticle(cookie, 'http://news.test/article#comments')
    expect([typed.status, await typed.json()]).toEqual([409, { error: 'exists', id }])
    routes.set('/short', (_req, res) => res.writeHead(302, { location: '/article?fbclid=1' }).end())
    const redirected = await fetchArticle(cookie, 'http://news.test/short')
    expect([redirected.status, await redirected.json()]).toEqual([409, { error: 'exists', id }])
    const other = await signedIn()
    expect((await fetchArticle(other.cookie, 'http://news.test/article')).status).toBe(200)
  })

  it('refuses no session and bad bodies', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await fetchArticle(null, 'http://news.test/article'))).toEqual([401, 'signed_out'])
    const send = (body: string) => handleArticleFetch(post('/account/articles/fetch', cookie, body), WEB)
    expect(await answer(await send('not json'))).toEqual([400, 'invalid'])
    expect(await answer(await send(JSON.stringify({ url: 1 })))).toEqual([400, 'invalid'])
    expect(await answer(await send(JSON.stringify({ url: 'a.test', more: 1 })))).toEqual([400, 'invalid'])
    expect(await answer(await send(JSON.stringify(['a.test'])))).toEqual([400, 'invalid'])
  })

  it('fails when the database does', async () => {
    const { cookie } = await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const actual = getDb()
    vi.mocked(getDb)
      .mockImplementationOnce(() => actual)
      .mockImplementationOnce(() => {
        throw new Error('down')
      })
    expect(await answer(await fetchArticle(cookie, 'http://news.test/article'))).toEqual([500, 'failed'])
  })
})

describe('POST /account/articles/picture', () => {
  it('serves a picture the page named, sniffed, with the headers of a stored picture', async () => {
    const { cookie } = await signedIn()
    const { fetch } = await fetched(cookie)
    const response = await fetchPicture(cookie, fetch, 'http://news.test/p.png')
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/png',
      'content-length': String(PNG.length),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, no-store',
    })
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true)
  })

  it('is a 404 for an address the page didn’t name, another reader’s fetch, an expired one and a non-picture', async () => {
    const { user, cookie } = await signedIn()
    const { fetch } = await fetched(cookie)
    expect(await answer(await fetchPicture(cookie, fetch, 'http://news.test/other.png'))).toEqual([404, 'not_found'])
    const other = await signedIn()
    expect(await answer(await fetchPicture(other.cookie, fetch, 'http://news.test/p.png'))).toEqual([404, 'not_found'])
    const old = hold(user.id, 'http://news.test/article', ['http://news.test/p.png'], Date.now() - PENDING_TTL_MS)
    expect(await answer(await fetchPicture(cookie, old, 'http://news.test/p.png'))).toEqual([404, 'not_found'])
    routes.set('/lazy.png', (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end('<svg></svg>'))
    expect(await answer(await fetchPicture(cookie, fetch, 'http://news.test/lazy.png'))).toEqual([404, 'not_found'])
    expect(await answer(await fetchPicture(cookie, fetch, 'http://news.test/p-800.png'))).toEqual([
      404,
      'page_not_found',
    ])
  })

  it('refuses a picture over 10 MB, and holds a reader to 1,200 an hour and the server to 8 at once', async () => {
    const { user, cookie } = await signedIn()
    const { fetch } = await fetched(cookie)
    routes.set('/p-800.png', (_req, res) =>
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(11 * 1024 * 1024) }).end(),
    )
    expect(await answer(await fetchPicture(cookie, fetch, 'http://news.test/p-800.png'))).toEqual([413, 'too_large'])
    const held = Array.from({ length: IN_FLIGHT_MAX.picture }, () => enter('picture'))
    expect(await answer(await fetchPicture(cookie, fetch, 'http://news.test/p.png'))).toEqual([503, 'busy'])
    for (const release of held) release?.()
    for (let i = 0; i < ARTICLE_PICTURE_LIMIT.max; i++) takeFetch('picture', user.id)
    expect(await answer(await fetchPicture(cookie, fetch, 'http://news.test/p.png'))).toEqual([429, 'limited'])
  })

  it('refuses no session and bad bodies', async () => {
    const { cookie } = await signedIn()
    const { fetch } = await fetched(cookie)
    const send = (body: unknown, c: string | null = cookie) =>
      handleArticlePicture(post('/account/articles/picture', c, body), WEB)
    expect(await answer(await send({ fetch, url: 'http://news.test/p.png' }, null))).toEqual([401, 'signed_out'])
    expect(await answer(await send({ fetch }))).toEqual([400, 'invalid'])
    expect(await answer(await send('nope'))).toEqual([400, 'invalid'])
  })

  it('is unavailable when resolving throws, and failed when anything else does', async () => {
    const { cookie } = await signedIn()
    const { fetch } = await fetched(cookie)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const request = () => post('/account/articles/picture', cookie, { fetch, url: 'http://news.test/p.png' })
    const resolving = handleArticlePicture(request(), {
      ...WEB,
      resolve: () => {
        throw new Error('not a promise')
      },
    })
    expect(await answer(await resolving)).toEqual([502, 'unavailable'])
    const broken = Object.defineProperty({ ...WEB }, 'timeouts', {
      enumerable: true,
      get() {
        throw new Error('broken')
      },
    })
    expect(await answer(await handleArticlePicture(request(), broken))).toEqual([500, 'failed'])
  })
})

describe('saving an article', () => {
  it('makes an article row from the pending fetch, and finishes it with its words and article.saved', async () => {
    const { user, cookie } = await signedIn()
    const id = await saved(cookie)
    const [row] = await raw<{ article_url: string; article_words: number; status: string }[]>`
      select article_url, article_words, status from user_books where id = ${id}`
    expect(row).toEqual({ article_url: 'http://news.test/article', article_words: 4, status: 'ready' })
    const events = await raw<{ event: string; detail: unknown }[]>`
      select event, detail from audit_events where user_id = ${user.id} order by id`
    expect(events).toEqual([{ event: 'article.saved', detail: { id, pictures: 0 } }])
    expect(await loadBookPage(db(), user.id, id)).toMatchObject({
      articleUrl: 'http://news.test/article',
      articleWords: 4,
    })
  })

  it('takes a fetch once, and refuses an expired, unknown or malformed one', async () => {
    const { cookie } = await signedIn()
    const { fetch } = await fetched(cookie)
    expect((await start(cookie, { ...META, article: fetch })).status).toBe(201)
    expect(await answer(await start(cookie, { ...META, article: fetch }))).toEqual([409, 'expired'])
    expect(await answer(await start(cookie, { ...META, article: '6f1c0000-0000-4000-8000-000000000000' }))).toEqual([
      409,
      'expired',
    ])
    expect(await answer(await start(cookie, { ...META, article: 'nope' }))).toEqual([400, 'invalid'])
    expect(await answer(await start(cookie, { ...META, article: 1 }))).toEqual([400, 'invalid'])
  })

  it('holds a plain member to the articles limit it is given, and counts articles apart from the books', async () => {
    const limits = { ...DEFAULT_LIMITS, articles: 3 }
    const { user } = await signedIn()
    const book = { ...META, details: NO_DETAILS }
    await fillArticles(user.id, 2)
    expect((await startImport(db(), user.id, book, new Date(), limits, { url: 'https://a.test/third' })).ok).toBe(true)
    expect(await countedArticles(db(), user.id)).toBe(3)
    expect(await startImport(db(), user.id, book, new Date(), limits, { url: 'https://a.test/fourth' })).toEqual({
      ok: false,
      reason: 'quota',
      max: 3,
    })
    expect(await countedBooks(db(), user.id)).toBe(0)
    expect((await startImport(db(), user.id, book, new Date(), limits)).ok).toBe(true)
  })

  it('says the article is saved already at the start too', async () => {
    const { cookie } = await signedIn()
    const first = await fetched(cookie)
    const second = await fetched(cookie)
    const id = await (async () => {
      const started = await start(cookie, { ...META, article: first.fetch })
      const { id } = (await started.json()) as { id: string }
      await handleChapter(post(`/account/books/${id}/chapters/0`, cookie, CHAPTER), id, '0')
      await handleFinish(post(`/account/books/${id}/finish`, cookie, {}), id)
      return id
    })()
    const again = await start(cookie, { ...META, article: second.fetch })
    expect([again.status, await again.json()]).toEqual([409, { error: 'exists', id }])
  })

  it('holds a reader to 60 saves an hour, without touching the imports’ 10', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into audit_events (user_id, event, detail)
      select ${user.id}, 'book.imported', '{}'::jsonb from generate_series(1, ${IMPORT_LIMIT.max})`
    expect((await start(cookie, { ...META, article: (await fetched(cookie)).fetch })).status).toBe(201)
    expect(await answer(await start(cookie, META))).toEqual([429, 'rate'])
    await raw`
      insert into audit_events (user_id, event, detail)
      select ${user.id}, 'article.saved', '{}'::jsonb from generate_series(1, ${ARTICLE_SAVE_LIMIT.max})`
    const limited = await start(cookie, {
      ...META,
      article: (await fetched(cookie, 'http://news.test/article?b')).fetch,
    })
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ error: 'limited', retryAt: expect.any(String) })
  })

  it('works on the store directly, with and without an article', async () => {
    const { user } = await signedIn()
    const book = { ...META, details: { description: null, isbn: null, publisher: null, publishedYear: null } }
    const article = await startImport(db(), user.id, book, new Date(), DEFAULT_LIMITS, { url: 'https://a.test/x' })
    if (!article.ok) throw new Error('refused')
    await storeChapter(
      db(),
      user.id,
      article.id,
      0,
      { title: 'x', pages: ['<p>one <em>two</em></p>', '<p></p>'] },
      DEFAULT_LIMITS,
    )
    expect(await finishImport(db(), user.id, article.id, null)).toBe('ok')
    expect(await listArticles(db(), user.id)).toMatchObject([{ id: article.id, words: 2, url: 'https://a.test/x' }])
  })
})

describe('reads and bookkeeping', () => {
  it('lists articles apart from books, newest first, and only the reader’s own', async () => {
    const { user, cookie } = await signedIn()
    const first = await saved(cookie, 'http://news.test/article?1')
    const second = await saved(cookie, 'http://news.test/article?2')
    expect(await listBooks(db(), user.id)).toEqual([])
    expect((await listArticles(db(), user.id)).map((a) => a.id)).toEqual([second, first])
    const state = await articlesState(get(cookie))
    expect(state).toMatchObject({
      state: 'ready',
      max: DEFAULT_LIMITS.articles,
      limits: DEFAULT_LIMITS,
      testHosts: [],
      imageBytesUsed: 0,
      articles: [
        { id: second, title: 'A long read', site: 'news.test', url: 'http://news.test/article?2', words: 4 },
        { id: first },
      ],
    })
    if (state.state === 'ready')
      expect(state.articles[0]?.readHref).toBe(`/read/${privateBookSlug(second)}/a-long-read`)
    const row = await myArticlesState(get(cookie))
    expect(row).toMatchObject({ slug: 'articles', title: 'Articles', books: [{ title: 'A long read' }, {}] })

    const other = await signedIn()
    expect(await articlesState(get(other.cookie))).toMatchObject({ state: 'ready', articles: [] })
    expect(await myArticlesState(get(other.cookie))).toBeNull()
    expect(await loadBookPage(db(), other.user.id, first)).toBeNull()
  })

  it('answers signed_out and unavailable', async () => {
    expect(await articlesState(get(null))).toEqual({ state: 'signed_out' })
    expect(await myArticlesState(get(null))).toBeNull()
    const { cookie } = await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = () => {
      throw new Error('down')
    }
    vi.mocked(getDb).mockImplementationOnce(broken)
    expect(await articlesState(get(cookie))).toEqual({ state: 'unavailable' })
    vi.mocked(getDb).mockImplementationOnce(broken)
    expect(await myArticlesState(get(cookie))).toBeNull()
  })

  it('exports the address and length, and deletes articles with the account', async () => {
    const { user, cookie } = await signedIn()
    const id = await saved(cookie)
    const rows = await readAccount(db(), user.id)
    expect(rows?.privateBooks).toMatchObject([{ id, articleUrl: 'http://news.test/article', articleWords: 4 }])
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from user_books where id = ${id}`).toHaveLength(0)
  })
})

describe('POST /account/articles (Delete)', () => {
  const form = (cookie: string | null, fields: Record<string, string>, headers: Record<string, string> = {}) =>
    handleArticlesForm(
      new Request(`${origin}/account/articles`, {
        method: 'POST',
        headers: { origin, ...(cookie ? { cookie } : {}), ...headers },
        body: new URLSearchParams(fields),
      }),
    )
  const where = (response: Response) => [response.status, response.headers.get('location')]

  it('deletes the reader’s article and goes back to the list', async () => {
    const { user, cookie } = await signedIn()
    const id = await saved(cookie)
    expect(where(await form(cookie, { intent: 'delete', id }))).toEqual([303, '/account/articles?status=deleted'])
    expect(await listArticles(db(), user.id)).toEqual([])
    const [event] = await raw<{ detail: unknown }[]>`select detail from audit_events where event = 'book.deleted'`
    expect(event?.detail).toEqual({ bookId: id })
  })

  it('deletes no book, and no other reader’s article', async () => {
    const { user, cookie } = await signedIn()
    const book = await startImport(
      db(),
      user.id,
      {
        ...META,
        details: { description: null, isbn: null, publisher: null, publishedYear: null },
      },
      new Date(),
      DEFAULT_LIMITS,
    )
    if (!book.ok) throw new Error('refused')
    expect(where(await form(cookie, { intent: 'delete', id: book.id }))).toEqual([
      303,
      '/account/articles?error=missing',
    ])
    const other = await signedIn()
    const theirs = await saved(other.cookie)
    expect(where(await form(cookie, { intent: 'delete', id: theirs }))).toEqual([
      303,
      '/account/articles?error=missing',
    ])
    expect(await listArticles(db(), other.user.id)).toHaveLength(1)
  })

  it('refuses no session and a bad form, and says when the database is down', async () => {
    const { cookie } = await signedIn()
    const id = await saved(cookie)
    expect(where(await form(null, { intent: 'delete', id }))).toEqual([303, '/login?next=%2Faccount%2Farticles'])
    expect(where(await form(cookie, { intent: 'keep', id }))).toEqual([303, '/account/articles?error=invalid'])
    expect(where(await form(cookie, { intent: 'delete', id: 'nope' }))).toEqual([
      303,
      '/account/articles?error=invalid',
    ])
    expect(where(await form(cookie, { intent: 'delete' }))).toEqual([303, '/account/articles?error=invalid'])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const actual = getDb()
    vi.mocked(getDb)
      .mockImplementationOnce(() => actual)
      .mockImplementationOnce(() => {
        throw new Error('down')
      })
    expect(where(await form(cookie, { intent: 'delete', id }))).toEqual([303, '/account/articles?error=unavailable'])
  })
})
