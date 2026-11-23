import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { handleApiKeys } from '~/server/account-actions'
import { handleUserChange } from '~/server/admin/actions'
import { deleteAccount } from '~/server/admin/store'
import { saveKey } from '~/server/api-keys'
import { handleAsk } from '~/server/ask/ask'
import { handleNewAudiobook } from '~/server/audiobooks/actions'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { handleCardChange, handleCardSave, handleFlashcardsForm } from '~/server/flashcards/actions'
import { bookFlashcardsState, flashcardBooksState } from '~/server/flashcards/page'
import { handleExport, handleExportAll } from '~/server/highlights/export'
import { handleTranslate } from '~/server/lookup/actions'
import { grantPro, planUsage, revokePro } from '~/server/plans/plan'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession, findSession } from '~/server/sessions'
import { handleSpeak, speechVoicesState } from '~/server/speech/actions'
import { DEVICE_FEATURES, type DeviceFeature, PRO_FEATURE_NAMES, type ProFeature } from '~/shared/plans/plans'
import { elevenLabsKey } from '../../../tests/e2e/support/elevenlabs-stub'
import { databaseUrl, freshDatabase } from '../testing/db'
import { testUser } from '../testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const HASH = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA'
const config = getConfig() as { audiobooksDir: string | null }

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, audit_events, api_keys, user_books, highlights, flashcards, subscriptions restart identity cascade`
})

let users = 0
async function signedIn(role: 'admin' | 'member' = 'member', plan: 'free' | 'pro' = 'free') {
  const user = await testUser(db(), `reader-${++users}`, HASH, role, { plan })
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}`, hash: hashToken(token) }
}

const post = (path: string, cookie: string, body = '{not json', type = 'application/json') =>
  new Request(`${origin}${path}`, { method: 'POST', headers: { origin, cookie, 'content-type': type }, body })

const get = (path: string, cookie: string) => new Request(`${origin}${path}`, { headers: { cookie } })

function watchedFetch() {
  const calls: string[] = []
  const fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response('{}', { status: 500 })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

describe('the plan in the session', () => {
  it('is Pro for an admin and a member given Pro, Free for any other member', async () => {
    const admin = await signedIn('admin')
    const given = await signedIn('member', 'pro')
    const member = await signedIn('member', 'free')
    expect((await findSession(db(), admin.hash))?.plan).toBe('pro')
    expect((await findSession(db(), given.hash))?.plan).toBe('pro')
    expect((await findSession(db(), member.hash))?.plan).toBe('free')
  })

  it('changes from the next request after a grant or a revocation', async () => {
    const { user, hash } = await signedIn()
    await grantPro(db(), user.id, { by: null, via: 'users script' })
    expect((await findSession(db(), hash))?.plan).toBe('pro')
    await revokePro(db(), user.id, { by: null, via: 'users script' })
    expect((await findSession(db(), hash))?.plan).toBe('free')
  })

  it('is Pro for a member while a subscription is active, trialing or past due, and paid where it comes from', async () => {
    const { user, hash } = await signedIn()
    const subscribe = (status: string) => raw`
      insert into subscriptions (id, user_id, price_id, cadence, founding, status, event_at)
      values ('sub_01plan', ${user.id}, 'pri_01m', 'month', false, ${status}, now())
      on conflict (id) do update set status = excluded.status`
    for (const [status, plan] of [
      ['active', 'pro'],
      ['trialing', 'pro'],
      ['past_due', 'pro'],
      ['paused', 'free'],
      ['canceled', 'free'],
    ] as const) {
      await subscribe(status)
      expect([status, (await findSession(db(), hash))?.plan]).toEqual([status, plan])
      expect((await planUsage(db(), user.id))?.source).toBe(plan === 'pro' ? 'paid' : 'free')
    }
    await subscribe('active')
    await grantPro(db(), user.id, { by: null, via: 'users script' })
    expect((await planUsage(db(), user.id))?.source).toBe('paid')
  })
})

describe('giving Pro', () => {
  const events = () =>
    raw<{ user_id: string; event: string; detail: Record<string, unknown> }[]>`
      select user_id, event, detail from audit_events where event like 'plan.%' order by id`

  it('gives and takes back Pro, audited, and keeps the first grant’s time', async () => {
    const admin = await signedIn('admin')
    const { user } = await signedIn()
    expect(await grantPro(db(), user.id, { by: admin.user.id, via: 'users page', ip: '198.51.100.4' })).toEqual({
      changed: true,
    })
    const [first] = await raw<{ at: Date; by: string }[]>`
      select pro_granted_at as at, pro_granted_by as by from users where id = ${user.id}`
    expect(Number(first?.by)).toBe(admin.user.id)
    expect(await grantPro(db(), user.id, { by: admin.user.id, via: 'users page' })).toEqual({ changed: false })
    const [again] = await raw<{ at: Date }[]>`select pro_granted_at as at from users where id = ${user.id}`
    expect(again?.at).toEqual(first?.at)

    expect(await revokePro(db(), user.id, { by: null, via: 'users script', osUser: 'owner' })).toEqual({
      changed: true,
    })
    expect(await revokePro(db(), user.id, { by: null, via: 'users script' })).toEqual({ changed: false })
    expect(await events()).toEqual([
      {
        user_id: String(user.id),
        event: 'plan.granted',
        detail: { user: user.username, by: admin.user.id, via: 'users page' },
      },
      {
        user_id: String(user.id),
        event: 'plan.revoked',
        detail: { user: user.username, by: null, via: 'users script', osUser: 'owner' },
      },
    ])
  })

  it('refuses an admin and an unknown account', async () => {
    const admin = await signedIn('admin')
    expect(await grantPro(db(), admin.user.id, { by: null, via: 'users script' })).toBe('admin')
    expect(await revokePro(db(), admin.user.id, { by: null, via: 'users script' })).toBe('admin')
    expect(await grantPro(db(), 999_999, { by: null, via: 'users script' })).toBe('not_found')
    expect(await events()).toEqual([])
  })

  it('keeps a grant when the admin who gave it is deleted', async () => {
    const admin = await signedIn('admin')
    await signedIn('admin')
    const { user, hash } = await signedIn()
    await grantPro(db(), user.id, { by: admin.user.id, via: 'users page' })
    expect(await deleteAccount(db(), admin.user.id, { detail: { via: 'users script' } })).toBe('deleted')
    const [row] = await raw<{ by: string | null }[]>`select pro_granted_by as by from users where id = ${user.id}`
    expect(row?.by).toBeNull()
    expect((await findSession(db(), hash))?.plan).toBe('pro')
  })

  describe('on the Users page', () => {
    const change = (cookie: string, username: string, intent: string) =>
      handleUserChange(post(`/account/users/${username}`, cookie, JSON.stringify({ intent })), username)

    it('gives a member Pro and takes it back, answering the new row', async () => {
      const admin = await signedIn('admin')
      const { user } = await signedIn()
      const given = await change(admin.cookie, user.username, 'grant-pro')
      expect([given.status, await given.json()]).toMatchObject([
        200,
        { user: { username: user.username, plan: 'pro', planSource: 'given' } },
      ])
      const taken = await change(admin.cookie, user.username, 'revoke-pro')
      expect([taken.status, await taken.json()]).toMatchObject([
        200,
        { user: { username: user.username, plan: 'free', planSource: 'free' } },
      ])
      expect((await events()).map((e) => [e.event, e.detail.via, e.detail.by])).toEqual([
        ['plan.granted', 'users page', admin.user.id],
        ['plan.revoked', 'users page', admin.user.id],
      ])
    })

    it('refuses a member, an unknown account and an admin', async () => {
      const admin = await signedIn('admin')
      const other = await signedIn('admin')
      const member = await signedIn('member', 'pro')
      const status = async (response: Response) => [
        response.status,
        ((await response.json()) as { error: string }).error,
      ]
      expect(await status(await change(member.cookie, other.user.username, 'grant-pro'))).toEqual([404, 'not_found'])
      expect(await status(await change(admin.cookie, 'nobody-here', 'grant-pro'))).toEqual([404, 'not_found'])
      expect(await status(await change(admin.cookie, 'NOT VALID', 'grant-pro'))).toEqual([404, 'not_found'])
      expect(await status(await change(admin.cookie, other.user.username, 'grant-pro'))).toEqual([409, 'admin'])
      expect(await status(await change(admin.cookie, other.user.username, 'revoke-pro'))).toEqual([409, 'admin'])
    })
  })
})

describe('the Plan section’s usage', () => {
  it('counts every book, a former starter copy too, and every highlight', async () => {
    const { user } = await signedIn()
    await raw`
      insert into user_books (user_id, title, author, language, chapter_count, starter)
      values (${user.id}, 'Pride and Prejudice', 'Jane Austen', 'en-GB', 1, true),
        (${user.id}, 'Mine', 'Ada', 'en', 1, false)`
    await raw`
      insert into highlights (user_id, book_slug, chapter, page, start_offset, end_offset, exact, color)
      select ${user.id}, 'pride-and-prejudice', 'chapter-1', 1, 0, 1, 'x', 'yellow' from generate_series(1, 12)`
    expect(await planUsage(db(), user.id)).toEqual({ source: 'free', books: 2, highlights: 12 })
    const admin = await signedIn('admin')
    expect(await planUsage(db(), admin.user.id)).toMatchObject({ source: 'admin', books: 0 })
    const given = await signedIn('member', 'pro')
    expect(await planUsage(db(), given.user.id)).toMatchObject({ source: 'given' })
    expect(await planUsage(db(), 999_999)).toBeNull()
  })
})

describe('the Pro features, on Free', () => {
  type Gated = Exclude<ProFeature, DeviceFeature>
  const GATED = PRO_FEATURE_NAMES.filter((f): f is Gated => !(DEVICE_FEATURES as readonly string[]).includes(f))
  const GATES: Record<Gated, (cookie: string, fetch: typeof globalThis.fetch) => Promise<Response>> = {
    ask: (cookie, fetch) => handleAsk(post('/read/pride-and-prejudice/ask', cookie), 'pride-and-prejudice', { fetch }),
    translate: (cookie, fetch) => handleTranslate(post('/account/lookup/translate', cookie), { fetch }),
    export: (cookie) =>
      handleExport(get('/account/highlights/export/pride-and-prejudice', cookie), 'pride-and-prejudice'),
    audiobooks: (cookie) => handleNewAudiobook(post('/account/books/new-audiobook', cookie)),
    elevenlabs: (cookie, fetch) => handleSpeak(post('/account/read-aloud/speak', cookie), { fetch }),
    flashcards: (cookie) => handleCardSave(post('/account/flashcards/new', cookie)),
  }

  it('answers 403 pro for every Pro feature, before the body and any outside call', async () => {
    config.audiobooksDir = null
    const { cookie } = await signedIn()
    const { calls, fetch } = watchedFetch()
    expect(Object.keys(GATES).sort()).toEqual([...GATED].sort())
    for (const feature of GATED) {
      const response = await GATES[feature](cookie, fetch)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      if (feature === 'export') {
        expect([response.status, await response.text()]).toEqual([403, 'Markdown export is part of Pro.'])
        continue
      }
      expect([feature, response.status, await response.json()]).toEqual([feature, 403, { error: 'pro', feature }])
    }
    expect(calls).toEqual([])
  })

  it('lets Pro past every gate', async () => {
    const { cookie } = await signedIn('member', 'pro')
    const { fetch } = watchedFetch()
    for (const feature of GATED) expect((await GATES[feature](cookie, fetch)).status).not.toBe(403)
  })

  it('refuses Export all as Markdown too', async () => {
    const { cookie } = await signedIn()
    const response = await handleExportAll(get('/account/highlights/export', cookie))
    expect([response.status, await response.text()]).toEqual([403, 'Markdown export is part of Pro.'])
  })

  it('refuses a review, and lets the reader delete their cards one by one or a book at a time', async () => {
    const { user, cookie } = await signedIn()
    const card = (front: string) => raw<{ id: string }[]>`
      insert into flashcards (user_id, book_slug, chapter, page, front, back, origin)
      values (${user.id}, 'pride-and-prejudice', 'chapter-1', 1, ${front}, 'Back', 'cards') returning id`
    const [one] = await card('One')
    await card('Two')
    await card('Three')
    const id = one?.id ?? ''
    const review = await handleCardChange(post(`/account/flashcards/${id}`, cookie, '{"review":"good"}'), id)
    expect([review.status, await review.json()]).toEqual([403, { error: 'pro', feature: 'flashcards' }])
    const removed = await handleCardChange(post(`/account/flashcards/${id}`, cookie, '{"delete":true}'), id)
    expect([removed.status, await removed.json()]).toEqual([200, { deleted: true }])

    const listed = { kind: 'pro', books: [{ slug: 'pride-and-prejudice', title: 'Pride and Prejudice', cards: 2 }] }
    expect(await flashcardBooksState(get('/account/flashcards', cookie))).toEqual(listed)
    expect(await bookFlashcardsState(get('/account/flashcards', cookie), 'pride-and-prejudice')).toEqual(listed)

    const form = (body: string) =>
      handleFlashcardsForm(post('/account/flashcards', cookie, body, 'application/x-www-form-urlencoded'))
    const deleted = await form('intent=delete-book&book=pride-and-prejudice')
    expect([deleted.status, deleted.headers.get('location')]).toEqual([303, '/account/flashcards?status=deleted-book'])
    expect((await raw`select 1 from flashcards`).count).toBe(0)
    expect((await form('intent=delete-book&book=pride-and-prejudice')).headers.get('location')).toBe(
      '/account/flashcards?error=missing',
    )
    expect((await form('intent=other&book=pride-and-prejudice')).headers.get('location')).toBe(
      '/account/flashcards?error=invalid',
    )
  })

  it('answers the flashcards form’s failing database on the page, logged', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      const failed = await handleFlashcardsForm(
        post(
          '/account/flashcards',
          cookie,
          'intent=delete-book&book=pride-and-prejudice',
          'application/x-www-form-urlencoded',
        ),
      )
      expect(failed.headers.get('location')).toBe('/account/flashcards?error=unavailable')
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^\[flashcards form\] /)])
    } finally {
      errors.mockRestore()
    }
  })

  it('lists no ElevenLabs voices, refuses saving a key, and still deletes a saved one', async () => {
    const { user, cookie } = await signedIn()
    const { calls, fetch } = watchedFetch()
    await saveKey(db(), user.id, 'elevenlabs', elevenLabsKey())
    expect(await speechVoicesState(get('/', cookie), 'pride-and-prejudice', { fetch })).toEqual({ state: 'pro' })
    const keys = (body: string) =>
      handleApiKeys(post('/account/api-keys', cookie, body, 'application/x-www-form-urlencoded'), { fetch })
    const save = await keys(`intent=save&provider=elevenlabs&key=${elevenLabsKey()}`)
    expect(save.headers.get('location')).toBe('/account/api-keys?error=pro&provider=elevenlabs#elevenlabs')
    expect(calls).toEqual([])
    const removed = await keys('intent=delete&provider=elevenlabs')
    expect(removed.headers.get('location')).toBe('/account/api-keys?status=deleted&provider=elevenlabs#elevenlabs')
    expect((await raw`select 1 from api_keys`).count).toBe(0)
  })
})
