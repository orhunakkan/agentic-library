import { afterAll, describe, expect, vi } from 'vitest'
import { it, raw } from '../../../support/server/db-test'
import { testUser } from '../../../support/server/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { deleteCard, type NewCardRequest, reviewCard, saveCard } from '~/client/features/flashcards/flashcards-client'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { handleCardChange, handleCardSave } from '~/server/flashcards/actions'
import { bookFlashcardsState } from '~/server/flashcards/page'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { MAX_CARDS_PER_BOOK, MAX_CARDS_PER_USER } from '~/shared/flashcards/limits'

const db = () => getDb()
const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const PRIDE = 'pride-and-prejudice'
const NOWHERE = '6f1c0000-0000-4000-8000-000000000000'

afterAll(async () => {
  await closeDb()
})

let users = 0

/** Signs a reader in, and routes the client's fetch to the real flashcards handlers with their cookie. */
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
    if (path === '/account/flashcards/new') return handleCardSave(request)
    const [, id] = /^\/account\/flashcards\/([^/]+)$/.exec(path) ?? []
    if (!id) throw new Error(`no flashcards route at ${path}`)
    return handleCardChange(request, decodeURIComponent(id))
  })
  const cards = async () => {
    const found = await bookFlashcardsState(new Request(`${origin}/account/flashcards`, { headers: { cookie } }), PRIDE)
    if (found.kind !== 'book') throw new Error(found.kind)
    return found.cards
  }
  return { user, cards }
}

const card = (over: Partial<NewCardRequest> = {}): NewCardRequest => ({
  book: PRIDE,
  front: 'Who is Mr. Darcy?',
  back: 'A rich and proud gentleman.',
  position: { chapter: 'chapter-3', page: 2 },
  origin: 'flashcards',
  ...over,
})

describe('the flashcards client against the flashcards endpoints', () => {
  it('saves, reviews and deletes a card, reading back what the server stored', async () => {
    const { cards } = await signedIn()
    const saved = await saveCard(card())
    if (!saved.ok) throw new Error(saved.problem)
    expect(saved.value).toEqual({
      existed: false,
      card: {
        id: expect.any(String),
        front: 'Who is Mr. Darcy?',
        back: 'A rich and proud gentleman.',
        source: { pageHref: '/read/pride-and-prejudice/chapter-3/2', label: 'Ch. 3 · p. 2' },
        box: 0,
        dueAt: expect.any(String),
        createdAt: expect.any(String),
      },
    })
    expect(await cards()).toEqual([saved.value.card])
    expect(await saveCard(card({ back: 'Something else' }))).toEqual({
      ok: true,
      value: { card: saved.value.card, existed: true },
    })

    const reviewed = await reviewCard(saved.value.card.id, 'good')
    if (!reviewed.ok) throw new Error(reviewed.problem)
    expect(reviewed.value).toMatchObject({ id: saved.value.card.id, box: 1, source: saved.value.card.source })
    expect(await cards()).toEqual([reviewed.value])

    expect(await deleteCard(saved.value.card.id)).toEqual({ ok: true, value: true })
    expect(await cards()).toEqual([])
  })

  it('reads each refusal the server sends as its problem', async () => {
    await signedIn()
    expect(await saveCard(card({ book: 'no-such-book' }))).toEqual({ ok: false, problem: 'not_found' })
    expect(await reviewCard(NOWHERE, 'good')).toEqual({ ok: false, problem: 'not_found' })
    expect(await reviewCard('not-a-uuid', 'again')).toEqual({ ok: false, problem: 'not_found' })
    expect(await deleteCard(NOWHERE)).toEqual({ ok: false, problem: 'not_found' })
    /** The server refuses a page past the chapter's end as invalid, a code the client has no problem of its own for. */
    expect(await saveCard(card({ position: { chapter: 'chapter-3', page: 99 } }))).toEqual({
      ok: false,
      problem: 'failed',
    })
    expect(await raw`select 1 from flashcards`).toHaveLength(0)
  })

  it('tells the book’s card limit and the reader’s card limit apart', async () => {
    const { user } = await signedIn()
    await raw`
      insert into flashcards (user_id, book_slug, chapter, page, front, back, origin)
      select ${user.id}, ${PRIDE}, 'chapter-1', 1, 'card ' || g, 'b', 'quiz'
      from generate_series(1, ${MAX_CARDS_PER_BOOK}) g`
    expect(await saveCard(card())).toEqual({ ok: false, problem: 'quota-book' })

    const other = await signedIn()
    await raw`
      insert into flashcards (user_id, book_slug, chapter, page, front, back, origin)
      select ${other.user.id}, 'book-' || (g / ${MAX_CARDS_PER_BOOK}), 'chapter-1', 1, 'card ' || g, 'b', 'quiz'
      from generate_series(1, ${MAX_CARDS_PER_USER}) g`
    expect(await saveCard(card())).toEqual({ ok: false, problem: 'quota-user' })
  })

  it('reads a signed-out answer as signed out', async () => {
    await signedIn(true)
    expect(await saveCard(card())).toEqual({ ok: false, problem: 'signed_out' })
    expect(await deleteCard(NOWHERE)).toEqual({ ok: false, problem: 'signed_out' })
  })

  it('reads the server failing as failed', async () => {
    await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    expect(await saveCard(card())).toEqual({ ok: false, problem: 'failed' })
  })
})
