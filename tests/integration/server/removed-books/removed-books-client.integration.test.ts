import { afterAll, describe, expect, vi } from 'vitest'
import { it } from '../../../support/server/db-test'
import { testUser } from '../../../support/server/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { setRemoved } from '~/client/features/removed-books/removed-books-client'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { handleRemovedBook, removedBooksState } from '~/server/removed-books/actions'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { privateBookSlug } from '~/shared/content/book-slug'

const db = () => getDb()
const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const PRIDE = 'pride-and-prejudice'

afterAll(async () => {
  await closeDb()
})

let users = 0

/** Signs a reader in, and routes the client's fetch to the real removed-books handler with their cookie. */
async function signedIn(signedOut = false) {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  const cookie = `${cookieName}=${token}`
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    headers.set('origin', origin)
    if (!signedOut) headers.set('cookie', cookie)
    if (path !== '/account/removed-books') throw new Error(`no removed-books route at ${path}`)
    return handleRemovedBook(new Request(`${origin}${path}`, { ...init, headers }))
  })
  const state = () => removedBooksState(new Request(`${origin}/library`, { headers: { cookie } }))
  return { user, state }
}

describe('the removed-books client against the removed-books endpoint', () => {
  it('removes and restores a book, reading back what the server stored', async () => {
    const { state } = await signedIn()
    expect(await setRemoved(PRIDE, true)).toEqual({ ok: true, value: true })
    expect(await state()).toEqual({ state: 'ready', books: [PRIDE] })
    expect(await setRemoved(PRIDE, true)).toEqual({ ok: true, value: true })
    expect(await setRemoved(PRIDE, false)).toEqual({ ok: true, value: false })
    expect(await state()).toEqual({ state: 'ready', books: [] })
  })

  it('reads each refusal the server sends as its problem', async () => {
    const { state } = await signedIn()
    expect(await setRemoved('no-such-book', true)).toEqual({ ok: false, problem: 'not_found' })
    /** The server refuses a private book as invalid, a code the client has no problem of its own for. */
    const privateBook = privateBookSlug('6f1c0000-0000-4000-8000-000000000000')
    expect(await setRemoved(privateBook, true)).toEqual({ ok: false, problem: 'failed' })
    expect(await state()).toEqual({ state: 'ready', books: [] })
  })

  it('reads a signed-out answer as signed out', async () => {
    await signedIn(true)
    expect(await setRemoved(PRIDE, true)).toEqual({ ok: false, problem: 'signed_out' })
  })

  it('reads the server failing as failed', async () => {
    await signedIn()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await setRemoved(PRIDE, true)).toEqual({ ok: false, problem: 'failed' })
    } finally {
      errors.mockRestore()
    }
  })
})
