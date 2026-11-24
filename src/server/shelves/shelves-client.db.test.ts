import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createShelf, deleteShelf, renameShelf, setShelfBook } from '~/client/features/shelves/shelves-client'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { handleShelfBook, handleShelfChange, handleShelfCreate, shelvesState } from '~/server/shelves/actions'
import type { signedInEndpoints } from '~/server/signed-in'
import type { ShelfErrorAnswer, ShelfErrorCode } from '~/shared/shelves/contract'
import { MAX_SHELF_BOOKS_PER_USER, MAX_SHELVES_PER_USER } from '~/shared/shelves/shelves'
import { databaseUrl, freshDatabase } from '../testing/db'
import { testUser } from '../testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const NOWHERE = '6f1c0000-0000-4000-8000-000000000000'

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, audit_events, user_books, shelves, shelf_books restart identity cascade`
})
afterEach(() => vi.unstubAllGlobals())

let users = 0

/** Signs a reader in, and routes the client's fetch to the real shelves handlers with their cookie. */
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
    if (path === '/account/shelves/new') return handleShelfCreate(request)
    const [, id, books] = /^\/account\/shelves\/([^/]+)(\/books)?$/.exec(path) ?? []
    if (!id) throw new Error(`no shelves route at ${path}`)
    return books ? handleShelfBook(request, decodeURIComponent(id)) : handleShelfChange(request, decodeURIComponent(id))
  })
  const state = () => shelvesState(new Request(`${origin}/library`, { headers: { cookie } }))
  return { user, state }
}

describe('the shelves client against the shelves endpoints', () => {
  it('makes, fills, renames and deletes a shelf, reading back what the server stored', async () => {
    const { state } = await signedIn()
    const made = await createShelf('  To   read ', 'pride-and-prejudice')
    if (!made.ok) throw new Error(made.problem)
    expect(made.value).toEqual({ id: expect.any(String), name: 'To read', books: ['pride-and-prejudice'] })
    expect(await state()).toEqual({ state: 'ready', shelves: [made.value] })

    const on = await setShelfBook(made.value.id, 'fixture-code-book', true)
    expect(on).toEqual({ ok: true, value: { ...made.value, books: ['fixture-code-book', 'pride-and-prejudice'] } })
    const off = await setShelfBook(made.value.id, 'pride-and-prejudice', false)
    expect(off).toEqual({ ok: true, value: { ...made.value, books: ['fixture-code-book'] } })
    const renamed = await renameShelf(made.value.id, 'Next up')
    expect(renamed).toEqual({ ok: true, value: { ...made.value, name: 'Next up', books: ['fixture-code-book'] } })
    expect(await state()).toEqual({ state: 'ready', shelves: [renamed.ok && renamed.value] })

    expect(await deleteShelf(made.value.id)).toEqual({ ok: true, value: true })
    expect(await state()).toEqual({ state: 'ready', shelves: [] })
    expect(await createShelf('Empty')).toMatchObject({ ok: true, value: { name: 'Empty', books: [] } })
  })

  it('reads each refusal the server sends as its problem', async () => {
    await signedIn()
    const made = await createShelf('To read')
    if (!made.ok) throw new Error(made.problem)
    expect(await createShelf('TO READ')).toEqual({ ok: false, problem: 'duplicate' })
    expect(await createShelf('   ')).toEqual({ ok: false, problem: 'invalid' })
    expect(await createShelf('X', 'no-such-book')).toEqual({ ok: false, problem: 'not_found' })
    expect(await renameShelf(NOWHERE, 'X')).toEqual({ ok: false, problem: 'not_found' })
    expect(await renameShelf('not-a-uuid', 'X')).toEqual({ ok: false, problem: 'not_found' })
    expect(await deleteShelf(NOWHERE)).toEqual({ ok: false, problem: 'not_found' })
    expect(await setShelfBook(made.value.id, 'no-such-book', true)).toEqual({ ok: false, problem: 'not_found' })
  })

  it('tells the shelves limit and the books-on-shelves limit apart', async () => {
    const { user } = await signedIn()
    await raw`
      insert into shelves (user_id, name, name_key)
      select ${user.id}, 'Shelf ' || g, 'shelf ' || g from generate_series(1, ${MAX_SHELVES_PER_USER - 1}) g`
    const last = await createShelf('Last')
    if (!last.ok) throw new Error(last.problem)
    expect(await createShelf('One more')).toEqual({ ok: false, problem: 'quota_shelves' })
    await raw`
      insert into shelf_books (shelf_id, user_id, book_slug)
      select ${last.value.id}, ${user.id}, 'book-' || g from generate_series(1, ${MAX_SHELF_BOOKS_PER_USER}) g`
    expect(await setShelfBook(last.value.id, 'pride-and-prejudice', true)).toEqual({
      ok: false,
      problem: 'quota_books',
    })
  })

  it('reads a signed-out answer as signed out', async () => {
    await signedIn(true)
    expect(await createShelf('To read')).toEqual({ ok: false, problem: 'signed_out' })
  })
})

describe("the shelves gate's refusals", () => {
  type Shelves = ReturnType<typeof signedInEndpoints<ShelfErrorCode, ShelfErrorAnswer>>

  it('type a quota refusal’s extras, and give other codes none', () => {
    /** Never run: tsc checks these calls. */
    const typed = (fail: Shelves['fail']) => [
      fail(409, 'quota', { scope: 'shelves', max: 50 }),
      fail(404, 'not_found'),
      // @ts-expect-error a quota refusal needs its scope and limit
      fail(409, 'quota'),
      // @ts-expect-error the scope is one of the two quotas
      fail(409, 'quota', { scope: 'books', max: 50 }),
      // @ts-expect-error a code the shelves endpoints don't send
      fail(409, 'stale'),
    ]
    expect(typeof typed).toBe('function')
  })
})
