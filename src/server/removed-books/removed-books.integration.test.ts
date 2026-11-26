import { afterAll, describe, expect, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { privateBookSlug } from '~/shared/content/book-slug'
import { it, raw } from '../testing/db-test'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { handleRemovedBook, libraryExclusionsFor, removedBooksState } from '~/server/removed-books/actions'
import { listRemoved, setRemoved } from '~/server/removed-books/store'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'

const db = () => getDb()

afterAll(async () => {
  await closeDb()
})

let users = 0
const newUser = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const PRIDE = 'pride-and-prejudice'
const CODE_BOOK = 'fixture-code-book'

describe('the store', () => {
  it('removes and restores a book, each twice without an error', async () => {
    const user = await newUser()
    expect(await listRemoved(db(), user.id)).toEqual([])
    await setRemoved(db(), user.id, PRIDE, true)
    await setRemoved(db(), user.id, PRIDE, true)
    await setRemoved(db(), user.id, CODE_BOOK, true)
    expect((await listRemoved(db(), user.id)).sort()).toEqual([CODE_BOOK, PRIDE])
    await setRemoved(db(), user.id, PRIDE, false)
    await setRemoved(db(), user.id, PRIDE, false)
    expect(await listRemoved(db(), user.id)).toEqual([CODE_BOOK])
  })

  it('keeps each reader’s removals to themselves', async () => {
    const ada = await newUser()
    const bob = await newUser()
    await setRemoved(db(), ada.id, PRIDE, true)
    expect(await listRemoved(db(), bob.id)).toEqual([])
    await setRemoved(db(), bob.id, PRIDE, false)
    expect(await listRemoved(db(), ada.id)).toEqual([PRIDE])
  })

  it('goes when the user is deleted', async () => {
    const user = await newUser()
    await setRemoved(db(), user.id, PRIDE, true)
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from removed_books`).toHaveLength(0)
  })

  it('refuses a slug outside the check', async () => {
    const user = await newUser()
    await expect(setRemoved(db(), user.id, '', true)).rejects.toThrow(/removed_books_book_slug_check/)
  })
})

describe('the endpoint and the reads', () => {
  const origin = getConfig().appOrigin
  const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'

  async function signedIn() {
    const user = await newUser()
    const token = newSessionToken()
    await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
    return { user, cookie: `${cookieName}=${token}` }
  }

  const post = (cookie: string | null, body: unknown) =>
    handleRemovedBook(
      new Request(`${origin}/account/removed-books`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )
  const get = (cookie: string | null) => new Request(`${origin}/`, { headers: cookie ? { cookie } : {} })

  const answer = async (response: Response) => [
    response.status,
    ((await response.json()) as { error?: string }).error ?? null,
  ]

  it('removes and restores a catalogue book, answering its state afterwards', async () => {
    const { user, cookie } = await signedIn()
    const removed = await post(cookie, { book: PRIDE, removed: true })
    expect([removed.status, await removed.json()]).toEqual([200, { book: PRIDE, removed: true }])
    expect(removed.headers.get('cache-control')).toBe('private, no-store')
    expect(await listRemoved(db(), user.id)).toEqual([PRIDE])
    expect(await removedBooksState(get(cookie))).toEqual({ state: 'ready', books: [PRIDE] })

    expect((await post(cookie, { book: PRIDE, removed: true })).status).toBe(200)
    const restored = await post(cookie, { book: PRIDE, removed: false })
    expect([restored.status, await restored.json()]).toEqual([200, { book: PRIDE, removed: false }])
    expect(await listRemoved(db(), user.id)).toEqual([])
    expect(await removedBooksState(get(cookie))).toEqual({ state: 'ready', books: [] })
  })

  it('leaves out only the books the reader removed, Pride and Prejudice like any other', async () => {
    const { user, cookie } = await signedIn()
    const exclusions = async () => [...(await libraryExclusionsFor(get(cookie)))].sort()
    expect(await exclusions()).toEqual([])
    await setRemoved(db(), user.id, CODE_BOOK, true)
    expect(await exclusions()).toEqual([CODE_BOOK])
    await setRemoved(db(), user.id, PRIDE, true)
    expect(await exclusions()).toEqual([CODE_BOOK, PRIDE])
  })

  it('maps every refusal to its status and code', async () => {
    const { cookie } = await signedIn()
    const body = { book: PRIDE, removed: true }
    expect(await answer(await post(null, body))).toEqual([401, 'signed_out'])
    expect(await answer(await post(cookie, 'not json'))).toEqual([400, 'invalid'])
    expect(await answer(await post(cookie, { book: PRIDE }))).toEqual([400, 'invalid'])
    const privateBook = privateBookSlug('6f1c0000-0000-4000-8000-000000000000')
    expect(await answer(await post(cookie, { book: privateBook, removed: true }))).toEqual([400, 'invalid'])
    expect(await answer(await post(cookie, { book: 'no-such-book', removed: true }))).toEqual([404, 'not_found'])
    expect(await raw`select 1 from removed_books`).toHaveLength(0)
  })

  it('reads as signed out without a session, and leaves nothing out', async () => {
    expect(await removedBooksState(get(null))).toEqual({ state: 'signed_out' })
    expect((await libraryExclusionsFor(get(null))).size).toBe(0)
  })

  it('answers failed, and reads as unavailable, when the database fails, and logs no body', async () => {
    const { cookie } = await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await post(cookie, { book: PRIDE, removed: true }))).toEqual([500, 'failed'])
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await removedBooksState(get(cookie))).toEqual({ state: 'unavailable' })
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect((await libraryExclusionsFor(get(cookie))).size).toBe(0)
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([
        expect.stringMatching(/^\[removed book\] /),
        expect.stringMatching(/^\[removed books\] /),
        expect.stringMatching(/^\[removed books\] /),
      ])
      expect(lines.join('\n')).not.toContain(PRIDE)
    } finally {
      errors.mockRestore()
    }
  })
})
