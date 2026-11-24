import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { privateBookSlug } from '~/shared/content/book-slug'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { handleAccountExport } from '~/server/account-data/handler'
import { readAccount } from '~/server/account-data/store'
import { recordEvent } from '~/server/audit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { databaseUrl, freshDatabase } from '../testing/db'
import { KEY_CIPHERTEXT, PASSWORD_HASH, userWithEveryRow } from '../testing/user-rows'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books, user_book_covers, user_book_images, highlights, bookmarks, flashcards, audio_bookmarks, reading_places, listening_places, reader_settings, shelves, shelf_books, email_tokens restart identity cascade`
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

async function signedIn(username = 'ada') {
  const user = await userWithEveryRow(raw, username)
  const token = newSessionToken()
  await createSession(getDb(), { tokenHash: hashToken(token), userId: user.userId, ip: null, userAgent: 'test' })
  return { ...user, cookie: `${cookieName}=${token}` }
}

const download = (cookie: string | null) =>
  handleAccountExport(new Request(`${origin}/account/export`, { headers: cookie ? { cookie } : {} }))

describe('GET /account/export', () => {
  it('sends a signed-out visitor to sign in, back to Your data', async () => {
    const response = await download(null)
    expect([response.status, response.headers.get('location')]).toEqual([302, '/login?next=%2Faccount%23data'])
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('downloads every section of the account, none of another user’s rows, and no secret', async () => {
    const ada = await signedIn('ada')
    await userWithEveryRow(raw, 'bob')
    const response = await download(ada.cookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const date = new Date().toISOString().slice(0, 10)
    expect(response.headers.get('content-disposition')).toBe(`attachment; filename="folio-account-ada-${date}.json"`)

    const text = await response.text()
    expect(text).toContain('\n  "format": "folio-account",')
    const data = JSON.parse(text)
    expect(data).toMatchObject({ format: 'folio-account', version: 1, site: origin })
    expect(data.account).toMatchObject({
      username: 'ada',
      role: 'member',
      aiModel: 'claude-haiku-5-5',
      speechModel: 'eleven_v4_turbo',
      email: 'ada@example.com',
      emailBouncedAt: null,
    })
    expect(data.account.emailVerifiedAt).toEqual(expect.any(String))
    expect(JSON.stringify(data)).not.toContain('ada-pending@example.com')
    expect(data.sessions.map((s: { device: string }) => s.device)).toEqual(['Safari on macOS', 'Unknown device'])
    expect(data.apiKeys).toEqual([expect.objectContaining({ provider: 'anthropic', last4: 'ab12' })])
    expect(data.readerSettings).toEqual({ theme: 'dark', font: 'literata', leading: 'normal', measure: 'normal' })
    expect(data.privateBooks).toEqual([
      expect.objectContaining({
        slug: privateBookSlug(ada.bookId),
        title: 'ada-mark book',
        chapters: ['Chapter one'],
        cover: { source: 'epub', width: 600, height: 900 },
        imageCount: 1,
        status: 'ready',
        audio: null,
      }),
      expect.objectContaining({
        slug: privateBookSlug(ada.audiobookId),
        title: 'ada-mark audiobook',
        chapters: [],
        audio: {
          narrator: 'Rex Reader',
          lengthMs: 9000,
          size: 36000,
          files: 1,
          chapters: [{ title: 'ada-mark audio chapter', durationMs: 9000 }],
        },
      }),
    ])
    expect(data.highlights).toEqual([
      expect.objectContaining({
        book: { slug: 'pride-and-prejudice', title: 'Pride and Prejudice' },
        text: 'ada-mark highlight',
        note: 'ada-mark note',
      }),
    ])
    expect(data.bookmarks[0]).toMatchObject({ book: { slug: privateBookSlug(ada.bookId), title: 'ada-mark book' } })
    expect(data.flashcards).toEqual([
      {
        book: { slug: 'pride-and-prejudice', title: 'Pride and Prejudice' },
        front: 'ada-mark card front',
        back: 'ada-mark card back',
        chapter: 'chapter-1',
        page: 1,
        box: 0,
        dueAt: expect.any(String),
        createdAt: expect.any(String),
      },
    ])
    expect(data.audioBookmarks[0]).toMatchObject({ kind: 'episode', positionMs: 61000 })
    expect(data.readingPlaces[0]).toMatchObject({ page: 3, device: 'Safari on Mac' })
    expect(data.listeningPlaces[0]).toMatchObject({ kind: 'voice', chapter: 'one' })
    expect(data.speechUsage).toEqual([{ minute: expect.any(String), characters: 321, requests: 3 }])
    expect(data.shelves).toEqual([
      expect.objectContaining({ name: 'ada-mark shelf', books: [expect.anything(), expect.anything()] }),
    ])
    expect(data.removedBooks).toEqual([
      { book: { slug: 'pride-and-prejudice', title: 'Pride and Prejudice' }, removedAt: expect.any(String) },
    ])
    expect(data.ratings).toHaveLength(2)
    expect(data.ratings).toEqual(
      expect.arrayContaining([
        { book: { slug: 'pride-and-prejudice', title: 'Pride and Prejudice' }, stars: 4, ratedAt: expect.any(String) },
        { book: { slug: privateBookSlug(ada.bookId), title: 'ada-mark book' }, stars: 2, ratedAt: expect.any(String) },
      ]),
    )
    expect(data.askPrompts).toEqual([
      {
        name: 'ada-mark prompt',
        appliesTo: 'pages',
        instruction: 'List who has come up so far.',
        position: 0,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ])
    expect(data.readingTime).toEqual([{ day: '2026-11-20', readingSeconds: 1234, listeningSeconds: 0 }])
    expect(data.finishedBooks).toEqual([
      { book: { slug: privateBookSlug(ada.bookId), title: 'ada-mark book' }, finishedAt: expect.any(String) },
    ])
    expect(data.readingGoals).toEqual([{ fromDay: '2026-11-01', minutes: 30, setAt: expect.any(String) }])
    expect(data.account.timeZone).toBe('Europe/Istanbul')
    const [sessionId] = await raw<{ id: string }[]>`select id from reading_time where user_id = ${ada.userId}`
    expect(text).not.toContain(sessionId?.id ?? 'missing')
    expect(data.activity.map((e: { event: string }) => e.event)).toEqual([
      'account.exported',
      'logout',
      'login.succeeded',
    ])

    expect(text).not.toContain('bob')
    expect(text).not.toContain(PASSWORD_HASH)
    expect(text).not.toContain(KEY_CIPHERTEXT.toString('utf8'))
    expect(text).not.toContain(KEY_CIPHERTEXT.toString('base64'))
    expect(text).not.toContain('page text')
    expect(text).not.toContain('token-hash')

    const [event] = await raw<{ detail: { bytes: number } }[]>`
      select detail from audit_events where event = 'account.exported' and user_id = ${ada.userId}`
    expect(event?.detail).toEqual({ bytes: Buffer.byteLength(text) })
  })

  it('refuses the 11th download within the hour', async () => {
    const ada = await signedIn()
    for (let i = 0; i < 9; i++) await recordEvent(getDb(), 'account.exported', { userId: ada.userId })
    await raw`
      insert into audit_events (user_id, event, at) values (${ada.userId}, 'account.exported', now() - interval '61 minutes')`
    expect((await download(ada.cookie)).status).toBe(200)
    const limited = await download(ada.cookie)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await limited.text()).toBe('You’ve downloaded your data 10 times in the last hour. Try again later.')
  })

  it('answers 500 when the database fails after sign-in, and logs it', async () => {
    const ada = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    try {
      vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
      const failed = await download(ada.cookie)
      expect([failed.status, await failed.text()]).toEqual([500, 'Something went wrong. Try again in a few minutes.'])
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringMatching(/^\[account export\] /)])
    } finally {
      errors.mockRestore()
    }
  })
})

describe('readAccount', () => {
  it('is null for an unknown user', async () => {
    expect(await readAccount(getDb(), 999)).toBeNull()
  })
})
