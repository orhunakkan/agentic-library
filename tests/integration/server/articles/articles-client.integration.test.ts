import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, vi } from 'vitest'
import { it, raw } from '../../../support/server/db-test'
import { testUser } from '../../../support/server/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { fetchArticle, fetchArticlePicture, startArticle } from '~/client/features/articles/articles-client'
import { articlesState, handleArticleFetch, handleArticlePicture } from '~/server/articles/actions'
import type { ResolvedAddress } from '~/server/articles/address-guard'
import { enter, IN_FLIGHT_MAX, resetPacing, takeFetch } from '~/server/articles/pacing'
import { resetPending } from '~/server/articles/pending'
import type { WebFetchOptions } from '~/server/articles/web-fetch'
import { handleNewBook } from '~/server/book-actions'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { ARTICLE_FETCH_LIMIT, ARTICLE_SAVE_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'

type Route = (request: IncomingMessage, response: ServerResponse) => void
const routes = new Map<string, Route>()
let server: Server
let port = 0

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000020000000200802000000fc18eda30000001d49444154789cedc1010d000000c2a0f74f6d0e37a00000000000000000be0d210000014e5b0e5f0000000049454e44ae426082',
  'hex',
)
const ARTICLE_HTML = `<!doctype html><html lang="en"><head><title>A long read</title></head><body>
  <article><h1>A long read</h1><p>${'Words of the article. '.repeat(40)}</p><img src="/p.png"></article></body></html>`
const ARTICLE = 'http://news.test/article'

/** Every site the server fetches from resolves to a public address, and is answered by the local server's routes. */
const WEB: WebFetchOptions = {
  resolve: async (): Promise<ResolvedAddress[]> => [{ address: '93.184.216.34', family: 4 }],
  connect: () => ({ address: '127.0.0.1', family: 4, port }),
}

const db = () => getDb()
const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const NOWHERE = '6f1c0000-0000-4000-8000-000000000000'

beforeAll(async () => {
  server = createServer((request, response) => {
    const route = routes.get(new URL(request.url ?? '/', 'http://x').pathname)
    if (route) route(request, response)
    else response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeDb()
})
beforeEach(() => {
  resetPacing()
  resetPending()
  routes.clear()
  routes.set('/article', (_request, response) =>
    response.writeHead(200, { 'content-type': 'text/html' }).end(ARTICLE_HTML),
  )
  routes.set('/p.png', (_request, response) => response.writeHead(200, { 'content-type': 'image/png' }).end(PNG))
})

let users = 0

/** Signs a reader in, and routes the client's fetch to the real article and book-start handlers with their cookie. */
async function signedIn(signedOut = false) {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  const cookie = `${cookieName}=${token}`
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    headers.set('origin', origin)
    if (!signedOut) headers.set('cookie', cookie)
    const request = new Request(`${origin}${path}`, { ...init, headers })
    if (path === '/account/articles/fetch') return handleArticleFetch(request, WEB)
    if (path === '/account/articles/picture') return handleArticlePicture(request, WEB)
    if (path === '/account/books/new') return handleNewBook(request)
    throw new Error(`no articles route at ${path}`)
  })
  const state = () => articlesState(new Request(`${origin}/account/articles`, { headers: { cookie } }))
  return { user, state }
}

const book = (article: string) => ({
  title: 'A long read',
  author: 'news.test',
  language: 'en',
  chapterCount: 1,
  description: null,
  isbn: null,
  publisher: null,
  publishedYear: null,
  images: { count: 0, bytes: 0 },
  article,
})

async function fetched(url = ARTICLE) {
  const result = await fetchArticle(url)
  if (!result.ok) throw new Error(result.problem)
  return result.value
}

/** A saved article at `url`, as a finished import leaves it. */
async function savedArticle(userId: number, url = ARTICLE) {
  const [row] = await raw<{ id: string }[]>`
    insert into user_books (user_id, title, author, language, chapter_count, status, ready_at, article_url)
    values (${userId}, 'A long read', 'news.test', 'en', 1, 'ready', now(), ${url})
    returning id`
  if (!row) throw new Error('no article')
  return row.id
}

describe('the articles client against the article endpoints', () => {
  it('fetches a page, a picture it names, and starts the article from the fetch', async () => {
    const { user } = await signedIn()
    const page = await fetched()
    expect(page).toEqual({ fetch: expect.any(String), finalUrl: ARTICLE, html: ARTICLE_HTML })

    const picture = await fetchArticlePicture(page.fetch, 'http://news.test/p.png')
    expect(picture && Buffer.from(picture).equals(PNG)).toBe(true)
    expect(await fetchArticlePicture(page.fetch, 'http://news.test/other.png')).toBeNull()

    const started = await startArticle(book(page.fetch))
    expect(started).toEqual({ ok: true, value: { id: expect.any(String), imageBytesLeft: expect.any(Number) } })
    const [row] = await raw`select id, article_url, status from user_books where user_id = ${user.id}`
    expect(row).toEqual({ id: started.ok && started.value.id, article_url: ARTICLE, status: 'uploading' })
  })

  it.each([
    ['empty', ''],
    ['too_long', `https://a.test/${'x'.repeat(2000)}`],
    ['not_url', 'not a url'],
    ['scheme', 'ftp://a.test/'],
    ['port', 'https://a.test:8080/'],
    ['credentials', 'https://u:p@a.test/'],
    ['private_host', 'http://localhost/x'],
    ['own_site', 'https://dev.agenticlibrary.app/library'],
  ])('reads an address refused as invalid for %s as that problem', async (reason, url) => {
    await signedIn()
    expect(await fetchArticle(url)).toEqual({ ok: false, problem: reason, failure: { problem: reason } })
  })

  it('reads each answer the site gave as its problem', async () => {
    await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    routes.set('/inside', (_request, response) => response.writeHead(302, { location: 'http://127.0.0.1:5432/' }).end())
    routes.set('/forbidden', (_request, response) => response.writeHead(403).end())
    routes.set('/broken', (_request, response) => response.writeHead(500).end())
    routes.set('/pdf', (_request, response) =>
      response.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF'),
    )
    routes.set('/huge', (_request, response) =>
      response.writeHead(200, { 'content-type': 'text/html', 'content-length': String(6 * 1024 * 1024) }).end(),
    )
    routes.set('/loop', (_request, response) => response.writeHead(302, { location: '/loop' }).end())
    const cases = [
      ['/inside', 'blocked'],
      ['/missing', 'page_not_found'],
      ['/forbidden', 'refused'],
      ['/broken', 'unavailable'],
      ['/pdf', 'not_html'],
      ['/huge', 'too_large'],
      ['/loop', 'too_many_redirects'],
    ] as const
    for (const [path, problem] of cases)
      expect(await fetchArticle(`http://news.test${path}`), path).toEqual({ ok: false, problem, failure: { problem } })
  })

  it('reads an article saved already as exists, with its id, at the fetch and at the start', async () => {
    const { user } = await signedIn()
    const page = await fetched()
    const id = await savedArticle(user.id)
    const exists = { ok: false, problem: 'exists', failure: { problem: 'exists', existingId: id } }
    expect(await fetchArticle(`${ARTICLE}#comments`)).toEqual(exists)
    expect(await startArticle(book(page.fetch))).toEqual(exists)
  })

  it('reads a fetch that was taken or never made as expired', async () => {
    await signedIn()
    const page = await fetched()
    expect((await startArticle(book(page.fetch))).ok).toBe(true)
    const expired = { ok: false, problem: 'expired', failure: { problem: 'expired' } }
    expect(await startArticle(book(page.fetch))).toEqual(expired)
    expect(await startArticle(book(NOWHERE))).toEqual(expired)
  })

  it('reads the fetch and save limits as limited, with when to try again, and a full server as busy', async () => {
    const { user } = await signedIn()
    const page = await fetched()
    for (let i = 0; i < ARTICLE_FETCH_LIMIT.max; i++) takeFetch('page', user.id)
    const limited = { ok: false, problem: 'limited', failure: { problem: 'limited', retryAt: expect.any(String) } }
    expect(await fetchArticle(ARTICLE)).toEqual(limited)
    await raw`
      insert into audit_events (user_id, event, detail)
      select ${user.id}, 'article.saved', '{}'::jsonb from generate_series(1, ${ARTICLE_SAVE_LIMIT.max})`
    expect(await startArticle(book(page.fetch))).toEqual(limited)

    resetPacing()
    const held = Array.from({ length: IN_FLIGHT_MAX.page }, () => enter('page'))
    expect(await fetchArticle(ARTICLE)).toEqual({ ok: false, problem: 'busy', failure: { problem: 'busy' } })
    for (const release of held) release?.()
  })

  it('reads the articles limit as quota, with the limit', async () => {
    const { user, state } = await signedIn()
    const page = await fetched()
    const { limits } = getConfig()
    await raw`
      insert into user_books (user_id, title, author, language, chapter_count, status, ready_at, article_url)
      select ${user.id}, 'Filler', 'a', 'en', 1, 'ready', now(), 'https://filler.test/' || n
      from generate_series(1, ${limits.articles}) n`
    expect(await startArticle(book(page.fetch))).toEqual({
      ok: false,
      problem: 'quota',
      failure: { problem: 'quota', max: limits.articles },
    })
    expect(await state()).toMatchObject({ state: 'ready', max: limits.articles })
  })

  it('reads a signed-out answer as signed out, from either side’s spelling of it', async () => {
    await signedIn(true)
    const signedOut = { ok: false, problem: 'signed_out', failure: { problem: 'signed_out' } }
    expect(await fetchArticle(ARTICLE)).toEqual(signedOut)
    expect(await startArticle(book(NOWHERE))).toEqual(signedOut)
    expect(await fetchArticlePicture(NOWHERE, 'http://news.test/p.png')).toBeNull()
  })

  it('reads the server failing as failed', async () => {
    await signedIn()
    const page = await fetched()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const failed = { ok: false, problem: 'failed', failure: { problem: 'failed' } }
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    expect(await fetchArticle(ARTICLE)).toEqual(failed)
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    expect(await startArticle(book(page.fetch))).toEqual(failed)
  })
})
