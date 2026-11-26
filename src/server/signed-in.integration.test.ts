import { afterAll, describe, expect, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb, isDatabaseConfigured } from '~/server/db'
import { it } from './testing/db-test'
import { testUser } from './testing/users'

vi.mock('./db.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db.ts')>()
  return { ...actual, getDb: vi.fn(actual.getDb), isDatabaseConfigured: vi.fn(actual.isDatabaseConfigured) }
})

import { createAccessToken } from './access-tokens/store.ts'
import { noStoreJson, seeOther, sessionForRequest as sessionLookup } from './auth.ts'
import { hashToken, newAccessToken, newSessionToken } from './security.ts'
import { createSession } from './sessions.ts'
import { MAX_FORM_BYTES, signedInEndpoints, signedInForm, signedInRead } from './signed-in.ts'

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

afterAll(async () => {
  await closeDb()
})

let users = 0
async function signedIn() {
  const user = await testUser(getDb(), `gate-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA')
  const token = newSessionToken()
  await createSession(getDb(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

interface Options {
  cookie?: string | null
  from?: string | null
  headers?: Record<string, string>
  body?: BodyInit | null
}

function req({ cookie = null, from = origin, headers = {}, body = '{"n":1}' }: Options = {}): Request {
  return new Request(`${origin}/account/dummy`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(from === null ? {} : { origin: from }),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body,
    duplex: 'half',
  } as RequestInit)
}

const answer = async (response: Response) => [
  response.status,
  response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : await response.text(),
]

type Snake = 'signed_out' | 'invalid' | 'not_found' | 'failed'
const snake = signedInEndpoints<Snake>({ maxBytes: 64 })

const echo = (request: Request) =>
  snake.post(request, { log: 'dummy' }, async ({ session, input }) =>
    noStoreJson(200, { user: session.username, input }),
  )

describe('origin and session', () => {
  it('lets a same-origin request with a session through to the work, with the parsed body', async () => {
    const { user, cookie } = await signedIn()
    const response = await echo(req({ cookie }))
    expect(await answer(response)).toEqual([200, { user: user.username, input: { n: 1 } }])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('refuses another origin with 403, before the session', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await echo(req({ cookie, from: 'https://evil.example' })))).toEqual([403, 'Forbidden'])
    expect(await answer(await echo(req({ cookie, from: null })))).toEqual([403, 'Forbidden'])
  })

  it('answers 401 signed_out without a session', async () => {
    expect(await answer(await echo(req()))).toEqual([401, { error: 'signed_out' }])
  })

  it('answers 404 not_found without a session where the handler asks, so nothing confirms a book exists', async () => {
    const hidden = (request: Request) =>
      snake.post(request, { log: 'dummy', signedOut: 404 }, async () => noStoreJson(200, {}))
    expect(await answer(await hidden(req()))).toEqual([404, { error: 'not_found' }])
  })

  it('answers with the group’s own codes', async () => {
    const hyphen = signedInEndpoints<'signed-out' | 'not-found' | 'invalid' | 'failed'>({
      maxBytes: 64,
      codes: { signedOut: 'signed-out', invalid: 'invalid', notFound: 'not-found', failed: 'failed' },
    })
    const handle = (request: Request, signedOut?: 401 | 404) =>
      hyphen.post(request, { log: 'dummy', signedOut }, async () => noStoreJson(200, {}))
    expect(await answer(await handle(req()))).toEqual([401, { error: 'signed-out' }])
    expect(await answer(await handle(req(), 404))).toEqual([404, { error: 'not-found' }])
    expect(await answer(hyphen.fail(409, 'invalid', { max: 3 }))).toEqual([409, { error: 'invalid', max: 3 }])
  })

  it('answers a group without a not-found code with its signed-out code, even where a handler asks for 404', async () => {
    const plain = signedInEndpoints<'signed_out' | 'invalid' | 'failed'>({
      maxBytes: 64,
      codes: { signedOut: 'signed_out', invalid: 'invalid', failed: 'failed' },
    })
    const handle = (request: Request) =>
      plain.post(request, { log: 'dummy', signedOut: 404 }, async () => noStoreJson(200, {}))
    expect(await answer(await handle(req()))).toEqual([404, { error: 'signed_out' }])
  })

  it('is signed out without a database, and asks it nothing', async () => {
    const { cookie } = await signedIn()
    vi.mocked(isDatabaseConfigured).mockReturnValueOnce(false)
    vi.mocked(getDb).mockClear()
    expect(await answer(await echo(req({ cookie })))).toEqual([401, { error: 'signed_out' }])
    expect(getDb).not.toHaveBeenCalled()
  })
})

describe('the body', () => {
  it('refuses a body that isn’t JSON with 415, one over the cap with 413 and malformed JSON with 400', async () => {
    const { cookie } = await signedIn()
    const invalid = { error: 'invalid' }
    expect(await answer(await echo(req({ cookie, headers: { 'content-type': 'text/plain' } })))).toEqual([415, invalid])
    expect(await answer(await echo(req({ cookie, body: JSON.stringify({ pad: 'x'.repeat(64) }) })))).toEqual([
      413,
      invalid,
    ])
    expect(await answer(await echo(req({ cookie, body: 'not json' })))).toEqual([400, invalid])
    expect(await answer(await echo(req({ cookie, body: null })))).toEqual([400, invalid])
  })

  it('refuses a streamed body that grows past the cap, which sent no length', async () => {
    const { cookie } = await signedIn()
    const chunk = new TextEncoder().encode(`"${'x'.repeat(40)}`)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.close()
      },
    })
    const request = req({ cookie, body: stream })
    expect(request.headers.get('content-length')).toBeNull()
    expect(await answer(await echo(request))).toEqual([413, { error: 'invalid' }])
  })

  it('answers a body over the cap with the group’s own code for it, when it has one', async () => {
    const { cookie } = await signedIn()
    const books = signedInEndpoints<'signed-out' | 'not-found' | 'invalid' | 'failed' | 'request-too-large'>({
      maxBytes: 64,
      codes: {
        signedOut: 'signed-out',
        invalid: 'invalid',
        notFound: 'not-found',
        failed: 'failed',
        tooLarge: 'request-too-large',
      },
    })
    const handle = (request: Request) => books.post(request, { log: 'dummy' }, async () => noStoreJson(200, {}))
    const big = JSON.stringify({ pad: 'x'.repeat(64) })
    expect(await answer(await handle(req({ cookie, body: big })))).toEqual([413, { error: 'request-too-large' }])
    expect(await answer(await handle(req({ cookie, body: 'not json' })))).toEqual([400, { error: 'invalid' }])
  })

  it('takes a handler’s own cap over the group’s', async () => {
    const { cookie } = await signedIn()
    const handle = (request: Request) =>
      snake.post(request, { log: 'dummy', body: { json: 8 } }, async () => noStoreJson(200, {}))
    expect((await handle(req({ cookie, body: '{"n":1}' }))).status).toBe(200)
    expect((await handle(req({ cookie, body: '{"n":12345}' }))).status).toBe(413)
  })

  it('reads raw bytes of the named types, refusing another type, too many bytes and none', async () => {
    const { cookie } = await signedIn()
    const handle = (request: Request) =>
      snake.post(request, { log: 'dummy', body: { bytes: 4, types: ['image/png'] } }, async ({ input }) =>
        noStoreJson(200, { type: input.type, length: input.bytes.length }),
      )
    const png = { 'content-type': 'image/png' }
    expect(await answer(await handle(req({ cookie, headers: png, body: 'abc' })))).toEqual([
      200,
      { type: 'image/png', length: 3 },
    ])
    expect(await answer(await handle(req({ cookie, body: 'abc' })))).toEqual([415, { error: 'invalid' }])
    expect(await answer(await handle(req({ cookie, headers: png, body: 'abcde' })))).toEqual([
      413,
      { error: 'invalid' },
    ])
    expect(await answer(await handle(req({ cookie, headers: png, body: '' })))).toEqual([400, { error: 'invalid' }])
  })

  it('leaves the body unread for a handler that reads its own', async () => {
    const { cookie } = await signedIn()
    const handle = (request: Request) =>
      snake.post(request, { log: 'dummy', body: 'none' }, async ({ input }) =>
        noStoreJson(200, { input: input ?? null, unread: !request.bodyUsed, text: await request.text() }),
      )
    expect(
      await answer(await handle(req({ cookie, headers: { 'content-type': 'text/plain' }, body: 'mine' }))),
    ).toEqual([200, { input: null, unread: true, text: 'mine' }])
  })
})

describe('parse and before', () => {
  const parseN = (value: unknown) =>
    typeof value === 'object' && value !== null && typeof (value as { n?: unknown }).n === 'number'
      ? (value as { n: number }).n
      : null

  it('refuses what the parser refuses with 400, and passes on a Response it gives', async () => {
    const { cookie } = await signedIn()
    const handle = (request: Request) =>
      snake.post(
        request,
        { log: 'dummy', parse: (value) => (parseN(value) === 9 ? snake.fail(422, 'not_found') : parseN(value)) },
        async ({ input }) => noStoreJson(200, { doubled: input * 2 }),
      )
    expect(await answer(await handle(req({ cookie, body: '{"n":2}' })))).toEqual([200, { doubled: 4 }])
    expect(await answer(await handle(req({ cookie, body: '{"m":2}' })))).toEqual([400, { error: 'invalid' }])
    expect(await answer(await handle(req({ cookie, body: '{"n":9}' })))).toEqual([422, { error: 'not_found' }])
  })

  it('runs before ahead of the body, and a Response from it ends the request with the body unread', async () => {
    const { user, cookie } = await signedIn()
    const work = vi.fn(async () => noStoreJson(200, {}))
    const handle = (request: Request) =>
      snake.post(
        request,
        {
          log: 'dummy',
          before: ({ session }) => (session.username === user.username ? snake.fail(403, 'not_found') : 1),
        },
        work,
      )
    const request = req({ cookie, body: 'not even json' })
    expect(await answer(await handle(request))).toEqual([403, { error: 'not_found' }])
    expect(request.bodyUsed).toBe(false)
    expect(work).not.toHaveBeenCalled()
  })

  it('hands what before found to the parser and the work', async () => {
    const { cookie } = await signedIn()
    const handle = (request: Request) =>
      snake.post(
        request,
        {
          log: 'dummy',
          before: async ({ session, db }) => {
            const [row] = await db<{ username: string }[]>`select username from users where id = ${session.userId}`
            return { name: row?.username ?? '', times: 3 }
          },
          parse: (value, pre) => {
            const n = parseN(value)
            return n === null ? null : n * pre.times
          },
        },
        async ({ pre, input }) => noStoreJson(200, { name: pre.name, input }),
      )
    const [status, body] = await answer(await handle(req({ cookie, body: '{"n":2}' })))
    expect([status, body]).toEqual([200, { name: expect.stringMatching(/^gate-/), input: 6 }])
  })
})

describe('failures', () => {
  const SECRET = 'a question nobody else may read'

  it('answers 500 failed when before, the parser or the work throws, logging the context and never the body', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = () => {
      throw new Error('gone away')
    }
    for (const spec of [{ before: boom }, { parse: boom }]) {
      const handle = (request: Request) =>
        snake.post(request, { log: 'dummy', ...spec }, async () => noStoreJson(200, {}))
      expect(await answer(await handle(req({ cookie, body: JSON.stringify({ q: SECRET }) })))).toEqual([
        500,
        { error: 'failed' },
      ])
    }
    const working = (request: Request) => snake.post(request, { log: 'dummy' }, async () => boom())
    expect(await answer(await working(req({ cookie, body: JSON.stringify({ q: SECRET }) })))).toEqual([
      500,
      { error: 'failed' },
    ])
    expect(errors).toHaveBeenCalledTimes(3)
    for (const [line] of errors.mock.calls) {
      expect(String(line)).toMatch(/^\[dummy\] Error: gone away/)
      expect(String(line)).not.toContain(SECRET)
    }
  })

  it('opens the database only when a hook or the work asks for it', async () => {
    const { cookie } = await signedIn()
    const request = req({ cookie })
    await sessionLookup(request)
    vi.mocked(getDb).mockClear()
    expect((await echo(request)).status).toBe(200)
    expect(getDb).not.toHaveBeenCalled()
    const counting = (request: Request) =>
      snake.post(request, { log: 'dummy', before: ({ db }) => db !== undefined }, async ({ db }) =>
        noStoreJson(200, { same: db === getDb() }),
      )
    const second = req({ cookie })
    await sessionLookup(second)
    vi.mocked(getDb).mockClear()
    expect(await answer(await counting(second))).toEqual([200, { same: true }])
    expect(getDb).toHaveBeenCalledTimes(2)
  })
})

describe('access tokens', () => {
  const api = signedInEndpoints<Snake>({ via: 'api', maxBytes: 64 })
  const handle = (request: Request) =>
    api.post(request, { log: 'dummy' }, async ({ session, via, tokenId }) =>
      noStoreJson(200, { user: session.username, via, tokenId }),
    )

  async function withToken() {
    const { user, cookie } = await signedIn()
    const token = newAccessToken()
    const row = await createAccessToken(getDb(), {
      userId: user.id,
      tokenHash: hashToken(token),
      name: 'cli',
      days: 30,
      ip: null,
      userAgent: 'test',
    })
    if (row === 'quota') throw new Error('quota')
    return { user, cookie, token, tokenId: row.id }
  }

  it('signs a bearer request in as the token’s user without an Origin, and says which way it came', async () => {
    const { user, cookie, token, tokenId } = await withToken()
    const bearer = { authorization: `Bearer ${token}` }
    expect(await answer(await handle(req({ from: null, headers: bearer })))).toEqual([
      200,
      { user: user.username, via: 'token', tokenId },
    ])
    expect(await answer(await handle(req({ cookie })))).toEqual([
      200,
      { user: user.username, via: 'cookie', tokenId: null },
    ])
    const cookieOnly = (request: Request) =>
      snake.post(request, { log: 'dummy' }, async ({ via, tokenId }) => noStoreJson(200, { via, tokenId }))
    expect(await answer(await cookieOnly(req({ cookie })))).toEqual([200, { via: 'cookie', tokenId: null }])
    expect((await cookieOnly(req({ headers: bearer }))).status).toBe(401)
  })

  it('refuses a bearer request from another origin with 403', async () => {
    const { token } = await withToken()
    const response = await handle(req({ from: 'https://evil.example', headers: { authorization: `Bearer ${token}` } }))
    expect(await answer(response)).toEqual([403, 'Forbidden'])
  })

  it('holds the cookie to the same origin, except on a GET, which changes nothing', async () => {
    const { user, cookie } = await withToken()
    expect(await answer(await handle(req({ cookie, from: null })))).toEqual([403, 'Forbidden'])
    expect(await answer(await handle(req({ cookie, from: 'https://evil.example' })))).toEqual([403, 'Forbidden'])
    const get = new Request(`${origin}/api/dummy`, { headers: { cookie } })
    const read = await api.post(get, { log: 'dummy', body: 'none' }, async ({ session, via }) =>
      noStoreJson(200, { user: session.username, via }),
    )
    expect(await answer(read)).toEqual([200, { user: user.username, via: 'cookie' }])
  })

  it('challenges a signed-out request, saying invalid_token when a token was sent', async () => {
    const plain = await handle(req())
    expect(await answer(plain)).toEqual([401, { error: 'signed_out' }])
    expect(plain.headers.get('www-authenticate')).toBe('Bearer')
    const bad = await handle(req({ from: null, headers: { authorization: `Bearer ${newAccessToken()}` } }))
    expect(await answer(bad)).toEqual([401, { error: 'signed_out' }])
    expect(bad.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"')
  })
})

describe('signedInForm', () => {
  const PAGE = '/account/dummy'
  const form = ({ cookie = null, from = origin, headers = {}, body = 'intent=go' }: Options = {}) =>
    req({ cookie, from, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body })
  const where = (response: Response) => [response.status, response.headers.get('location')]
  const handle = (request: Request) =>
    signedInForm(request, { log: 'dummy form', next: PAGE }, async ({ session, form }) =>
      seeOther(`${PAGE}?status=${form.get('intent')}&user=${session.username}`),
    )

  it('hands a same-origin form post with a session to the work, with its fields', async () => {
    const { user, cookie } = await signedIn()
    const response = await handle(form({ cookie }))
    expect(where(response)).toEqual([303, `${PAGE}?status=go&user=${user.username}`])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const multipart = new FormData()
    multipart.set('intent', 'multi')
    const sent = new Request(`${origin}${PAGE}`, { method: 'POST', headers: { origin, cookie }, body: multipart })
    expect(where(await handle(sent))).toEqual([303, `${PAGE}?status=multi&user=${user.username}`])
  })

  it('refuses another origin with 403, before the session', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await handle(form({ cookie, from: 'https://evil.example' })))).toEqual([403, 'Forbidden'])
    expect(await answer(await handle(form({ cookie, from: null })))).toEqual([403, 'Forbidden'])
  })

  it('sends a signed-out reader to sign in, and back to next afterwards', async () => {
    expect(where(await handle(form()))).toEqual([303, `/login?next=${encodeURIComponent(PAGE)}`])
    const { cookie } = await signedIn()
    vi.mocked(isDatabaseConfigured).mockReturnValueOnce(false)
    expect(where(await handle(form({ cookie })))).toEqual([303, `/login?next=${encodeURIComponent(PAGE)}`])
  })

  it('answers a body over the cap or one that isn’t a form with ?error=invalid, and never runs the work', async () => {
    const { cookie } = await signedIn()
    const work = vi.fn(async () => seeOther(PAGE))
    const gated = (request: Request) => signedInForm(request, { log: 'dummy form', next: PAGE }, work)
    const invalid = [303, `${PAGE}?error=invalid`]
    expect(where(await gated(form({ cookie, body: `intent=${'x'.repeat(MAX_FORM_BYTES)}` })))).toEqual(invalid)
    expect(where(await gated(form({ cookie, headers: { 'content-type': 'application/json' }, body: '{}' })))).toEqual(
      invalid,
    )
    expect(where(await gated(form({ cookie, headers: { 'content-type': 'multipart/form-data' }, body: 'x' })))).toEqual(
      invalid,
    )
    expect(work).not.toHaveBeenCalled()
  })

  it('refuses a streamed body that grows past the cap, which sent no length', async () => {
    const { cookie } = await signedIn()
    const chunk = new TextEncoder().encode(`intent=${'x'.repeat(MAX_FORM_BYTES / 2)}`)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.close()
      },
    })
    const request = form({ cookie, body: stream })
    expect(request.headers.get('content-length')).toBeNull()
    expect(where(await handle(request))).toEqual([303, `${PAGE}?error=invalid`])
  })

  it('runs before ahead of the form, and a Response from it ends the request with the form unread', async () => {
    const { cookie } = await signedIn()
    const work = vi.fn(async () => seeOther(PAGE))
    const request = form({ cookie })
    const response = await signedInForm(
      request,
      { log: 'dummy form', next: PAGE, before: () => new Response('Not found', { status: 404 }) },
      work,
    )
    expect(await answer(response)).toEqual([404, 'Not found'])
    expect(request.bodyUsed).toBe(false)
    expect(work).not.toHaveBeenCalled()
    expect(where(await signedInForm(form(), { log: 'x', next: PAGE, before: () => seeOther('/') }, work))).toEqual([
      303,
      `/login?next=${encodeURIComponent(PAGE)}`,
    ])
  })

  it('answers ?error=unavailable when the work throws, or the handler’s own, logged without the form', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const SECRET = 'sk-ant-nobody-may-read-this'
    const body = `intent=save&key=${SECRET}`
    const boom = async (): Promise<Response> => {
      throw new Error('gone away')
    }
    expect(where(await signedInForm(form({ cookie, body }), { log: 'dummy form', next: PAGE }, boom))).toEqual([
      303,
      `${PAGE}?error=unavailable`,
    ])
    const own = await signedInForm(
      form({ cookie, body }),
      { log: 'dummy form', next: PAGE, failed: (fields) => seeOther(`${PAGE}?error=failed#${fields.get('intent')}`) },
      boom,
    )
    expect(where(own)).toEqual([303, `${PAGE}?error=failed#save`])
    expect(errors).toHaveBeenCalledTimes(2)
    for (const [line] of errors.mock.calls) {
      expect(String(line)).toMatch(/^\[dummy form\] Error: gone away/)
      expect(String(line)).not.toContain(SECRET)
    }
  })
})

describe('signedInRead', () => {
  const get = (cookie: string | null) => new Request(`${origin}/`, { headers: cookie ? { cookie } : {} })
  const names = (request: Request) =>
    signedInRead(request, 'dummy read', async ({ session, db }) => {
      const [row] = await db<{ username: string }[]>`select username from users where id = ${session.userId}`
      return { state: 'ready' as const, name: row?.username }
    })

  it('answers the work’s value for a signed-in reader', async () => {
    const { user, cookie } = await signedIn()
    expect(await names(get(cookie))).toEqual({ state: 'ready', name: user.username })
  })

  it('is signed out without a session or a database', async () => {
    const { cookie } = await signedIn()
    expect(await names(get(null))).toEqual({ state: 'signed_out' })
    vi.mocked(isDatabaseConfigured).mockReturnValueOnce(false)
    vi.mocked(getDb).mockClear()
    expect(await names(get(cookie))).toEqual({ state: 'signed_out' })
    expect(getDb).not.toHaveBeenCalled()
  })

  it('is unavailable when the work throws, logged with its context', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = signedInRead(get(cookie), 'dummy read', async () => {
      throw new Error('gone away')
    })
    expect(await broken).toEqual({ state: 'unavailable' })
    expect(String(errors.mock.calls[0]?.[0])).toMatch(/^\[dummy read\] Error: gone away/)
  })

  it('answers a fallback of the caller’s own for either', async () => {
    const { cookie } = await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fallback = { signedOut: { state: 'hidden' as const }, unavailable: null }
    const read = (request: Request) =>
      signedInRead(
        request,
        'dummy read',
        async () => {
          throw new Error('gone away')
        },
        fallback,
      )
    expect(await read(get(null))).toEqual({ state: 'hidden' })
    expect(await read(get(cookie))).toBeNull()
    const halfway = await signedInRead(get(null), 'dummy read', async () => 1, { unavailable: null })
    expect(halfway).toEqual({ state: 'signed_out' })
  })
})
