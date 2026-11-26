import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { saveKey } from '~/server/api-keys'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { handleTranslate, handleWordLookup } from '~/server/lookup/actions'
import { MAX_IN_FLIGHT, requestsInFlight, resetWikimedia } from '~/server/lookup/wikimedia'
import { TRANSLATE_LIMIT, WORD_LOOKUP_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { finishImport, startImport, storeChapter } from '~/server/user-books'
import { setAiModel } from '~/server/users'
import { NO_DETAILS } from '~/shared/import/details'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { anthropicStub, STUB_KEYS } from '../../../tests/stubs/anthropic-stub'
import { openAiKey, openAiStub, STUB_OPENAI_KEYS } from '../../../tests/stubs/openai-stub'
import { STUB_TERMS, wikimediaStub } from '../../../tests/stubs/wikimedia-stub'
import { databaseUrl, freshDatabase } from '../testing/db'
import { spend } from '../testing/quota'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books restart identity cascade`
  resetWikimedia()
  sent.length = 0
})
afterEach(() => {
  vi.restoreAllMocks()
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const key = (ending = '0000') => `sk-ant-test-valid-${'x'.repeat(16)}${ending}`
const BOOK = 'pride-and-prejudice'

let users = 0
/** A plain member: no grant and no subscription, so every case shows Translate works for any account with a key. */
async function reader({ withKey = key() as string | null } = {}) {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  if (withKey) await saveKey(db(), user.id, 'anthropic', withKey)
  return { user, cookie: `${cookieName}=${token}` }
}

async function privateBook(userId: number, language: string, ready = true) {
  const start = await startImport(
    db(),
    userId,
    {
      title: 'Carnet',
      author: 'Ada',
      language,
      details: NO_DETAILS,
      chapterCount: 1,
    },
    new Date(),
    DEFAULT_LIMITS,
  )
  if (!start.ok) throw new Error('could not start')
  if (ready) {
    await storeChapter(db(), userId, start.id, 0, { title: 'Un', pages: ['<p>Paris.</p>'] }, DEFAULT_LIMITS)
    expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  }
  return privateBookSlug(start.id)
}

const sent: string[] = []
const wikimediaFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  sent.push(url)
  const stubUrl = url
    .replace(/^https:\/\/en\.wiktionary\.org\//, 'http://stub/wiktionary/')
    .replace(/^https:\/\/([a-z]{2,3})\.wikipedia\.org\//, 'http://stub/wikipedia/$1/')
  return wikimediaStub(new Request(stubUrl, init))
}) as typeof fetch
const anthropicFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  return request.url.startsWith(getConfig().openAiApiBase) ? openAiStub(request) : anthropicStub(request)
}) as typeof fetch

function post(path: string, cookie: string | null, payload: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

const word = (cookie: string | null, payload: unknown, headers: Record<string, string> = {}) =>
  handleWordLookup(post('/account/lookup/word', cookie, payload, headers), { fetch: wikimediaFetch })
const translate = (cookie: string | null, payload: unknown, headers: Record<string, string> = {}) =>
  handleTranslate(post('/account/lookup/translate', cookie, payload, headers), { fetch: anthropicFetch })

async function details(event: string, userId: number) {
  const rows = await raw<{ detail: Record<string, unknown> }[]>`
    select detail from audit_events where event = ${event} and user_id = ${userId} order by id`
  return rows.map((r) => r.detail)
}

describe('both handlers', () => {
  const cases = [
    ['word', word, { book: BOOK, term: 'chaise', source: 'dictionary' }],
    ['translate', translate, { book: BOOK, text: 'chaise', to: 'tr' }],
  ] as const

  for (const [name, handler, good] of cases) {
    it(`${name}: refuses a signed-out reader`, async () => {
      const signedOut = await handler(null, good)
      expect(signedOut.status).toBe(401)
      expect(await signedOut.json()).toEqual({ error: 'signed_out' })
      expect(signedOut.headers.get('cache-control')).toBe('private, no-store')
    })

    it(`${name}: refuses a bad body`, async () => {
      const { cookie } = await reader()
      expect((await handler(cookie, '{not json')).status).toBe(400)
      expect((await handler(cookie, { ...good, extra: true })).status).toBe(400)
    })

    it(`${name}: is a 404 for an unknown book, another reader’s and an unfinished one`, async () => {
      const { user, cookie } = await reader()
      const other = await reader()
      const theirs = await privateBook(other.user.id, 'en')
      const unfinished = await privateBook(user.id, 'en', false)
      for (const book of ['no-such-book', theirs, unfinished]) {
        const res = await handler(cookie, { ...good, book })
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error: 'not_found' })
      }
    })
  }
})

describe('POST /account/lookup/word', () => {
  it('answers a dictionary entry as text, with its Wiktionary page, and audits no term', async () => {
    const { user, cookie } = await reader({ withKey: null })
    const res = await word(cookie, { book: BOOK, term: '“chaise,”', source: 'dictionary' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const answer = await res.json()
    expect(answer).toMatchObject({
      state: 'found',
      source: 'dictionary',
      term: 'chaise',
      language: 'en',
      languageName: 'English',
      otherLanguage: false,
      url: 'https://en.wiktionary.org/wiki/chaise',
    })
    expect(answer.senses[0]).toMatchObject({ partOfSpeech: 'Noun' })
    expect(answer.senses[0].definitions[0].text).toMatch(/^An open, horse-drawn carriage/)
    expect(sent).toEqual(['https://en.wiktionary.org/api/rest_v1/page/definition/chaise'])
    expect(await details('word.looked_up', user.id)).toEqual([
      { book: BOOK, source: 'dictionary', outcome: 'found', retried: false },
    ])
    expect(JSON.stringify(await raw`select * from audit_events`)).not.toContain('chaise')
  })

  it('asks once more in lower case for a capitalised word, and says so in the audit', async () => {
    const { user, cookie } = await reader()
    const res = await word(cookie, { book: BOOK, term: 'However', source: 'dictionary' })
    expect(await res.json()).toMatchObject({ state: 'found', term: 'however' })
    expect(sent.map((u) => u.split('/').at(-1))).toEqual(['However', 'however'])
    expect(await details('word.looked_up', user.id)).toEqual([
      { book: BOOK, source: 'dictionary', outcome: 'found', retried: true },
    ])
  })

  it('says when Wiktionary has no entry, and Wikipedia no article, with its search page', async () => {
    const { user, cookie } = await reader()
    const none = await word(cookie, { book: BOOK, term: 'Bingley', source: 'dictionary' })
    expect(await none.json()).toEqual({ state: 'not-found' })
    const article = await word(cookie, { book: BOOK, term: 'Lucas Lodge', source: 'wikipedia' })
    expect(await article.json()).toEqual({
      state: 'not-found',
      searchUrl: 'https://en.wikipedia.org/w/index.php?search=Lucas+Lodge',
    })
    expect(sent.at(-1)).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/Lucas_Lodge')
    expect((await details('word.looked_up', user.id)).map((d) => d.outcome)).toEqual(['not-found', 'not-found'])
  })

  it('answers a Wikipedia summary and a disambiguation page', async () => {
    const { user, cookie } = await reader()
    const found = await word(cookie, { book: BOOK, term: 'Michaelmas', source: 'wikipedia' })
    expect(await found.json()).toEqual({
      state: 'found',
      source: 'wikipedia',
      title: 'Michaelmas',
      description: 'Christian festival',
      extract: expect.stringMatching(/^Michaelmas, also known as/),
      url: 'https://en.wikipedia.org/wiki/Michaelmas',
    })
    const ambiguous = await word(cookie, { book: BOOK, term: 'Bennet', source: 'wikipedia' })
    expect(await ambiguous.json()).toEqual({
      state: 'ambiguous',
      title: 'Bennet',
      url: 'https://en.wikipedia.org/wiki/Bennet',
    })
    expect((await details('word.looked_up', user.id)).map((d) => d.outcome)).toEqual(['found', 'ambiguous'])
  })

  it('asks the book’s language’s Wikipedia, and labels another language’s entries', async () => {
    const { user, cookie } = await reader()
    const book = await privateBook(user.id, 'fr-CA')
    const paris = await word(cookie, { book, term: 'Paris', source: 'wikipedia' })
    expect(await paris.json()).toMatchObject({ state: 'found', title: 'Paris' })
    expect(sent.at(-1)).toBe('https://fr.wikipedia.org/api/rest_v1/page/summary/Paris')
    const soon = await word(cookie, { book: BOOK, term: 'bientôt', source: 'dictionary' })
    expect(await soon.json()).toMatchObject({ language: 'fr', languageName: 'French', otherLanguage: true })
  })

  it('answers busy and unavailable, and follows a redirect on the same host', async () => {
    const { user, cookie } = await reader()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const busy = await word(cookie, { book: BOOK, term: STUB_TERMS.busy, source: 'dictionary' })
    expect(busy.status).toBe(503)
    expect(await busy.json()).toEqual({ error: 'busy' })
    const broken = await word(cookie, { book: BOOK, term: STUB_TERMS.broken, source: 'wikipedia' })
    expect(broken.status).toBe(502)
    expect(await broken.json()).toEqual({ error: 'unavailable' })
    const moved = await word(cookie, { book: BOOK, term: 'Redirected', source: 'dictionary' })
    expect(await moved.json()).toMatchObject({ state: 'found', term: 'Redirected' })
    expect((await details('word.looked_up', user.id)).map((d) => d.outcome)).toEqual(['busy', 'unavailable', 'found'])
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).not.toContain(STUB_TERMS.broken)
  })

  it('answers the cache for a word asked before, without asking Wikimedia again', async () => {
    const { user, cookie } = await reader()
    await word(cookie, { book: BOOK, term: 'chaise', source: 'dictionary' })
    await word(cookie, { book: BOOK, term: 'Bingley', source: 'dictionary' })
    const again = await word(cookie, { book: BOOK, term: 'chaise', source: 'dictionary' })
    const missing = await word(cookie, { book: BOOK, term: 'Bingley', source: 'dictionary' })
    expect(await again.json()).toMatchObject({ state: 'found' })
    expect(await missing.json()).toEqual({ state: 'not-found' })
    expect(sent).toHaveLength(3)
    expect(await details('word.looked_up', user.id)).toHaveLength(4)
  })

  it('answers busy without sending past 8 requests in flight', async () => {
    const { cookie } = await reader()
    const release: (() => void)[] = []
    const hold = ((input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => release.push(() => resolve(wikimediaFetch(input, init))))) as typeof fetch
    const held = Array.from({ length: MAX_IN_FLIGHT }, (_, i) =>
      handleWordLookup(post('/account/lookup/word', cookie, { book: BOOK, term: `word${i}x`, source: 'wikipedia' }), {
        fetch: hold,
      }),
    )
    for (let i = 0; i < 100 && requestsInFlight() < MAX_IN_FLIGHT; i++) await new Promise((r) => setTimeout(r, 10))
    const refused = await word(cookie, { book: BOOK, term: 'chaise', source: 'dictionary' })
    expect(refused.status).toBe(503)
    for (const go of release) go()
    expect((await Promise.all(held)).map((r) => r.status)).toEqual(Array(MAX_IN_FLIGHT).fill(200))
    expect(requestsInFlight()).toBe(0)
  })

  it('refuses the 301st lookup within an hour, with when to try again', async () => {
    const { user, cookie } = await reader()
    await spend(db(), user.id, 'word-lookup', WORD_LOOKUP_LIMIT.max)
    const res = await word(cookie, { book: BOOK, term: 'chaise', source: 'dictionary' })
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('rate')
    expect(new Date(body.retryAt).getTime()).toBeGreaterThan(Date.now() + 58 * 60_000)
    expect(sent).toEqual([])
  })

  it('asks again once a cached answer is 6 hours old', async () => {
    const { cookie } = await reader()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await word(cookie, { book: BOOK, term: 'chaise', source: 'dictionary' })
      vi.setSystemTime(Date.now() + 6 * 60 * 60_000 + 1)
      await word(cookie, { book: BOOK, term: 'chaise', source: 'dictionary' })
    } finally {
      vi.useRealTimers()
    }
    expect(sent).toHaveLength(2)
  })

  it('answers unavailable for a 200 that isn’t JSON', async () => {
    const { cookie } = await reader()
    const garbled = (async () => new Response('<html>maintenance</html>', { status: 200 })) as typeof fetch
    const res = await handleWordLookup(
      post('/account/lookup/word', cookie, { book: BOOK, term: 'chaise', source: 'dictionary' }),
      { fetch: garbled },
    )
    expect([res.status, await res.json()]).toEqual([502, { error: 'unavailable' }])
  })

  it('refuses a term that isn’t one', async () => {
    const { cookie } = await reader()
    expect((await word(cookie, { book: BOOK, term: 'four words in it', source: 'dictionary' })).status).toBe(400)
  })
})

describe('POST /account/lookup/translate', () => {
  it('translates a term in its sentence with the reader’s model, and audits no text', async () => {
    const { user, cookie } = await reader()
    await setAiModel(db(), user.id, 'claude-sonnet-5-5')
    const res = await translate(cookie, {
      book: BOOK,
      text: 'chaise',
      context: 'He came down on Monday in a chaise and four.',
      to: 'tr',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ translation: '[tr] chaise\nSense: He', model: 'claude-sonnet-5-5' })
    expect(await details('word.translated', user.id)).toEqual([
      {
        book: BOOK,
        kind: 'term',
        to: 'tr',
        model: 'claude-sonnet-5-5',
        provider: 'anthropic',
        servedBy: 'claude-sonnet-5-5',
        inputTokens: 90,
        outputTokens: 12,
        error: null,
      },
    ])
    const audit = JSON.stringify(await raw`select * from audit_events`)
    expect(audit).not.toContain('chaise')
    expect(audit).not.toContain('Monday')
  })

  it('translates a passage, keeping its paragraphs, in a private book', async () => {
    const { user, cookie } = await reader()
    const book = await privateBook(user.id, 'fr')
    const res = await translate(cookie, { book, text: 'Il était une fois.\n\nLa fin.', to: 'en' })
    expect(await res.json()).toEqual({ translation: '[en] Il était une fois.\n\nLa fin.', model: 'claude-opus-5-5' })
    expect((await details('word.translated', user.id))[0]).toMatchObject({ kind: 'passage', to: 'en' })
  })

  it('is 409 without a key', async () => {
    const { cookie } = await reader({ withKey: null })
    const res = await translate(cookie, { book: BOOK, text: 'chaise', to: 'tr' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_key' })
  })

  it('maps Anthropic’s errors, and logs a failure without the text', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases = [
      [STUB_KEYS.rejected, 502, 'key_rejected'],
      [STUB_KEYS.billing, 502, 'billing'],
      [STUB_KEYS.overloaded, 503, 'busy'],
      [STUB_KEYS.rateLimited, 503, 'busy'],
      [STUB_KEYS.refusal, 502, 'refused'],
      [STUB_KEYS.tooLong, 502, 'failed'],
    ] as const
    for (const [ending, status, error] of cases) {
      const { user, cookie } = await reader({ withKey: key(ending) })
      const res = await translate(cookie, { book: BOOK, text: 'Netherfield is let at last', to: 'de' })
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ error })
      expect((await details('word.translated', user.id))[0]).toMatchObject({ error })
    }
    const logged = errors.mock.calls.flat().join(' ')
    expect(logged).toContain('[translate]')
    expect(logged).not.toContain('Netherfield')
  })

  it('stops when the browser goes away, and audits it as stopped', async () => {
    const { user, cookie } = await reader({ withKey: key(STUB_KEYS.slow) })
    const leave = new AbortController()
    const request = new Request(post('/account/lookup/translate', cookie, { book: BOOK, text: 'chaise', to: 'tr' }), {
      signal: leave.signal,
    })
    const pending = handleTranslate(request, { fetch: anthropicFetch })
    setTimeout(() => leave.abort(), 100)
    expect((await pending).status).toBe(502)
    expect((await details('word.translated', user.id))[0]).toMatchObject({ error: 'stopped', servedBy: null })
  })

  it('refuses the 121st translation within an hour, with when to try again', async () => {
    const { user, cookie } = await reader()
    await spend(db(), user.id, 'translate', TRANSLATE_LIMIT.max)
    const res = await translate(cookie, { book: BOOK, text: 'chaise', to: 'tr' })
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('rate')
  })

  it('refuses a target outside the list', async () => {
    const { cookie } = await reader()
    expect((await translate(cookie, { book: BOOK, text: 'chaise', to: 'tlh' })).status).toBe(400)
  })
})

describe('POST /account/lookup/translate on a GPT model', () => {
  async function gptReader({ openai = openAiKey() as string | null, anthropic = false } = {}) {
    const found = await reader({ withKey: anthropic ? key() : null })
    if (openai) await saveKey(db(), found.user.id, 'openai', openai)
    await setAiModel(db(), found.user.id, 'gpt-6.1-terra')
    return found
  }

  it('translates through OpenAI on the reader’s key, credits the chosen GPT model, and audits no text', async () => {
    const { user, cookie } = await gptReader({ anthropic: true })
    const res = await translate(cookie, {
      book: BOOK,
      text: 'chaise',
      context: 'He came down on Monday in a chaise and four.',
      to: 'tr',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translation: '[tr] chaise\nSense: He', model: 'gpt-6.1-terra' })
    expect(await details('word.translated', user.id)).toEqual([
      {
        book: BOOK,
        kind: 'term',
        to: 'tr',
        model: 'gpt-6.1-terra',
        provider: 'openai',
        servedBy: 'gpt-6.1-terra-2026-10-01',
        inputTokens: 90,
        outputTokens: 12,
        error: null,
      },
    ])
    const audit = JSON.stringify(await raw`select * from audit_events`)
    expect(audit).not.toContain('chaise')
    const used = await raw<{ provider: string; used: boolean }[]>`
      select provider, last_used_at is not null as used from api_keys order by provider`
    expect(used).toEqual([
      { provider: 'anthropic', used: false },
      { provider: 'openai', used: true },
    ])
  })

  it('records input tokens without the ones OpenAI served from its cache, as Ask does', async () => {
    const { user, cookie } = await gptReader({ openai: openAiKey(STUB_OPENAI_KEYS.cached) })
    expect((await translate(cookie, { book: BOOK, text: 'chaise', to: 'tr' })).status).toBe(200)
    expect((await details('word.translated', user.id))[0]).toMatchObject({
      provider: 'openai',
      inputTokens: 200,
      outputTokens: 12,
    })
  })

  it('is 409 no_key with only an Anthropic key, and doesn’t fall back to Claude', async () => {
    const { user, cookie } = await gptReader({ openai: null, anthropic: true })
    const res = await translate(cookie, { book: BOOK, text: 'chaise', to: 'tr' })
    expect([res.status, await res.json()]).toEqual([409, { error: 'no_key' }])
    expect(await details('word.translated', user.id)).toEqual([])
  })

  it('maps OpenAI’s errors, and logs a failure without the text or the key', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases = [
      [STUB_OPENAI_KEYS.rejected, 502, 'key_rejected'],
      [STUB_OPENAI_KEYS.billing, 502, 'billing'],
      [STUB_OPENAI_KEYS.rateLimited, 503, 'busy'],
      [STUB_OPENAI_KEYS.down, 503, 'busy'],
      [STUB_OPENAI_KEYS.refusal, 502, 'refused'],
      [STUB_OPENAI_KEYS.tooLong, 502, 'failed'],
    ] as const
    for (const [ending, status, error] of cases) {
      const { user, cookie } = await gptReader({ openai: openAiKey(ending) })
      const res = await translate(cookie, { book: BOOK, text: 'Netherfield is let at last', to: 'de' })
      expect([res.status, await res.json()], ending).toEqual([status, { error }])
      expect((await details('word.translated', user.id))[0]).toMatchObject({ error, provider: 'openai' })
    }
    const logged = errors.mock.calls.flat().join(' ')
    expect(logged).toContain('[translate]')
    expect(logged).not.toContain('Netherfield')
    expect(logged).not.toContain('sk-test-openai')
  })
})

describe('when the database fails', () => {
  it('answers 500 failed and logs it, for both routes', async () => {
    const { cookie } = await reader()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    const looked = await word(cookie, { book: BOOK, term: 'chaise', source: 'dictionary' })
    expect([looked.status, await looked.json()]).toEqual([500, { error: 'failed' }])
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    const translated = await translate(cookie, { book: BOOK, text: 'chaise', to: 'tr' })
    expect([translated.status, await translated.json()]).toEqual([500, { error: 'failed' }])
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringMatching(/^\[word lookup\] /),
      expect.stringMatching(/^\[translate\] /),
    ])
  })
})
