import { afterAll, beforeEach, describe, expect, vi } from 'vitest'
import { it } from '../../../support/server/db-test'
import { testUser } from '../../../support/server/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { lookUpWord, translate } from '~/client/features/lookup/lookup-client'
import { saveKey } from '~/server/api-keys'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { handleTranslate, handleWordLookup } from '~/server/lookup/actions'
import { resetWikimedia } from '~/server/lookup/wikimedia'
import { TRANSLATE_LIMIT, WORD_LOOKUP_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { anthropicStub, STUB_KEYS } from '../../../stubs/anthropic-stub'
import { STUB_TERMS, wikimediaStub } from '../../../stubs/wikimedia-stub'
import { spend } from '../../../support/server/quota'

const db = () => getDb()
const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const BOOK = 'pride-and-prejudice'
const anthropicKey = (ending = '0000') => `sk-ant-test-valid-${'x'.repeat(16)}${ending}`

afterAll(async () => {
  await closeDb()
})
beforeEach(() => {
  resetWikimedia()
})

/** Wikimedia's addresses, answered by the stub. */
const wikimediaFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
    .replace(/^https:\/\/en\.wiktionary\.org\//, 'http://stub/wiktionary/')
    .replace(/^https:\/\/([a-z]{2,3})\.wikipedia\.org\//, 'http://stub/wikipedia/$1/')
  return wikimediaStub(new Request(url, init))
}) as typeof fetch
const anthropicFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  anthropicStub(new Request(input, init))) as typeof fetch

let users = 0

/**
 * Signs a reader in, with an Anthropic key ending in `keyEnding` unless it is null, and routes the client's fetch to
 * the real lookup handlers with their cookie, the handlers' own requests going to the Wikimedia and Anthropic stubs.
 */
async function signedIn({ signedOut = false, keyEnding = '0000' as string | null } = {}) {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  if (keyEnding !== null) await saveKey(db(), user.id, 'anthropic', anthropicKey(keyEnding))
  const cookie = `${cookieName}=${token}`
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    headers.set('origin', origin)
    if (!signedOut) headers.set('cookie', cookie)
    const request = new Request(`${origin}${path}`, { ...init, headers })
    if (path === '/account/lookup/word') return handleWordLookup(request, { fetch: wikimediaFetch })
    if (path === '/account/lookup/translate') return handleTranslate(request, { fetch: anthropicFetch })
    throw new Error(`no lookup route at ${path}`)
  })
  return { user }
}

describe('the lookup client against the word endpoint', () => {
  it('reads a dictionary entry, a Wikipedia summary, a disambiguation page and no article', async () => {
    await signedIn()
    const entry = await lookUpWord({ book: BOOK, term: 'chaise', source: 'dictionary' })
    expect(entry).toMatchObject({
      ok: true,
      value: {
        state: 'found',
        source: 'dictionary',
        term: 'chaise',
        language: 'en',
        languageName: 'English',
        otherLanguage: false,
        senses: [{ partOfSpeech: 'Noun' }],
        url: 'https://en.wiktionary.org/wiki/chaise',
      },
    })
    expect(await lookUpWord({ book: BOOK, term: 'Michaelmas', source: 'wikipedia' })).toEqual({
      ok: true,
      value: {
        state: 'found',
        source: 'wikipedia',
        title: 'Michaelmas',
        description: 'Christian festival',
        extract: expect.stringMatching(/^Michaelmas, also known as/),
        url: 'https://en.wikipedia.org/wiki/Michaelmas',
      },
    })
    expect(await lookUpWord({ book: BOOK, term: 'Bennet', source: 'wikipedia' })).toEqual({
      ok: true,
      value: { state: 'ambiguous', title: 'Bennet', url: 'https://en.wikipedia.org/wiki/Bennet' },
    })
    expect(await lookUpWord({ book: BOOK, term: 'Lucas Lodge', source: 'wikipedia' })).toEqual({
      ok: true,
      value: { state: 'not-found', searchUrl: 'https://en.wikipedia.org/w/index.php?search=Lucas+Lodge' },
    })
  })

  it('reads each refusal the server sends as its problem', async () => {
    await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await lookUpWord({ book: 'no-such-book', term: 'chaise', source: 'dictionary' })).toEqual({
      ok: false,
      problem: 'not_found',
    })
    expect(await lookUpWord({ book: BOOK, term: STUB_TERMS.busy, source: 'dictionary' })).toEqual({
      ok: false,
      problem: 'busy',
    })
    expect(await lookUpWord({ book: BOOK, term: STUB_TERMS.broken, source: 'wikipedia' })).toEqual({
      ok: false,
      problem: 'unavailable',
    })
    /** The server refuses a phrase as invalid, a code the client has no problem of its own for. */
    expect(await lookUpWord({ book: BOOK, term: 'four words in it', source: 'dictionary' })).toEqual({
      ok: false,
      problem: 'failed',
    })
  })

  it('reads the hourly limit as rate, with when to try again', async () => {
    const { user } = await signedIn()
    await spend(db(), user.id, 'word-lookup', WORD_LOOKUP_LIMIT.max)
    const limited = await lookUpWord({ book: BOOK, term: 'chaise', source: 'dictionary' })
    expect(limited).toEqual({ ok: false, problem: 'rate', retryAt: expect.any(Date) })
    expect(!limited.ok && limited.retryAt && limited.retryAt.getTime()).toBeGreaterThan(Date.now() + 58 * 60_000)
  })
})

describe('the lookup client against the translate endpoint', () => {
  it('reads a translation and the model that made it', async () => {
    await signedIn()
    expect(await translate({ book: BOOK, text: 'Il était une fois.', to: 'en' })).toEqual({
      ok: true,
      value: { translation: '[en] Il était une fois.', model: 'claude-opus-5-5' },
    })
  })

  it('reads each refusal the server sends as its problem', async () => {
    const { user } = await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await translate({ book: 'no-such-book', text: 'chaise', to: 'tr' })).toEqual({
      ok: false,
      problem: 'not_found',
    })
    /** The server refuses a language outside its list as invalid, a code the client has no problem of its own for. */
    const unlisted = { book: BOOK, text: 'chaise', to: 'tlh' } as unknown as Parameters<typeof translate>[0]
    expect(await translate(unlisted)).toEqual({ ok: false, problem: 'failed' })
    await spend(db(), user.id, 'translate', TRANSLATE_LIMIT.max)
    expect(await translate({ book: BOOK, text: 'chaise', to: 'tr' })).toEqual({
      ok: false,
      problem: 'rate',
      retryAt: expect.any(Date),
    })
  })

  it('reads a reader without a key as no_key', async () => {
    await signedIn({ keyEnding: null })
    expect(await translate({ book: BOOK, text: 'chaise', to: 'tr' })).toEqual({ ok: false, problem: 'no_key' })
  })

  it('reads each of Anthropic’s refusals as its problem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases = [
      [STUB_KEYS.rejected, 'key_rejected'],
      [STUB_KEYS.billing, 'billing'],
      [STUB_KEYS.overloaded, 'busy'],
      [STUB_KEYS.refusal, 'refused'],
      [STUB_KEYS.tooLong, 'failed'],
    ] as const
    for (const [keyEnding, problem] of cases) {
      await signedIn({ keyEnding })
      expect(await translate({ book: BOOK, text: 'Netherfield is let at last', to: 'de' }), keyEnding).toEqual({
        ok: false,
        problem,
      })
    }
  })
})

describe('the lookup client, signed out or with the server failing', () => {
  it('reads a signed-out answer as signed out', async () => {
    await signedIn({ signedOut: true })
    expect(await lookUpWord({ book: BOOK, term: 'chaise', source: 'dictionary' })).toEqual({
      ok: false,
      problem: 'signed_out',
    })
    expect(await translate({ book: BOOK, text: 'chaise', to: 'tr' })).toEqual({ ok: false, problem: 'signed_out' })
  })

  it('reads the server failing as failed', async () => {
    await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    expect(await lookUpWord({ book: BOOK, term: 'chaise', source: 'dictionary' })).toEqual({
      ok: false,
      problem: 'failed',
    })
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    expect(await translate({ book: BOOK, text: 'chaise', to: 'tr' })).toEqual({ ok: false, problem: 'failed' })
  })
})
