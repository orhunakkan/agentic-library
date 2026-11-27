import { describe, expect, it, vi } from 'vitest'
import {
  ACTION_LABELS,
  addUser,
  changeFor,
  changeUser,
  createInvite,
  deleteUser,
  doneText,
  problemText,
  revokeInvite,
} from '~/client/features/admin/admin-client'
import { ADMIN_PROBLEMS, type AdminUserView, type InviteView } from '~/shared/admin/users'

const USER: AdminUserView = {
  username: 'ada',
  role: 'member',
  status: 'active',
  lockedUntil: null,
  createdAt: '2026-11-06T12:00:00.000Z',
  lastActiveAt: null,
  sessions: 0,
  hasKey: false,
  email: 'none',
  you: false,
}

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const sent = (fetch: ReturnType<typeof answer>) => {
  const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  return [path, init.method, (init.headers as Record<string, string>)['content-type'], JSON.parse(String(init.body))]
}

describe('the requests', () => {
  it('post each change to its route', async () => {
    let fetch = answer(200, { user: USER, password: 'p' })
    await addUser('ada', 'admin')
    expect(sent(fetch)).toEqual(['/account/users/new', 'POST', 'application/json', { username: 'ada', role: 'admin' }])
    fetch = answer(200, { user: USER })
    await changeUser('ada', { intent: 'role', role: 'admin' })
    expect(sent(fetch)).toEqual(['/account/users/ada', 'POST', 'application/json', { intent: 'role', role: 'admin' }])
    fetch = answer(200, { user: USER })
    await changeUser('ada-1', { intent: 'unlock' })
    expect(sent(fetch)).toEqual(['/account/users/ada-1', 'POST', 'application/json', { intent: 'unlock' }])
    fetch = answer(200, { deleted: 'ada' })
    await deleteUser('ada')
    expect(sent(fetch)).toEqual(['/account/users/ada', 'POST', 'application/json', { intent: 'delete' }])
  })

  it('pass the password through untouched, and read the row and the deleted name', async () => {
    const password = 'Zx9-~ "quoted" \\ password'
    answer(200, { user: USER, password })
    expect(await addUser('ada', 'member')).toEqual({ ok: true, value: { user: USER, password } })
    answer(200, { user: USER, password })
    expect(await changeUser('ada', { intent: 'reset-password' })).toEqual({ ok: true, value: { user: USER, password } })
    answer(200, { user: USER })
    expect(await changeUser('ada', { intent: 'disable' })).toEqual({ ok: true, value: { user: USER, password: null } })
    answer(200, { deleted: 'ada' })
    expect(await deleteUser('ada')).toEqual({ ok: true, value: 'ada' })
  })
})

const INVITE: InviteView = {
  id: '0b9d1f2e-3c4a-4b5c-8d6e-7f8091a2b3c4',
  note: 'for Ann',
  by: 'orhun',
  createdAt: '2026-11-06T12:00:00.000Z',
  expiresAt: '2026-11-13T12:00:00.000Z',
}
const LINK = 'https://agenticlibrary.app/signup?token=abc'

describe('the invite requests', () => {
  it('post a note, trimmed, or none, and read the invite and its link', async () => {
    let fetch = answer(200, { invite: INVITE, link: LINK })
    expect(await createInvite('  for Ann ')).toEqual({ ok: true, value: { invite: INVITE, link: LINK } })
    expect(sent(fetch)).toEqual(['/account/users/invites/new', 'POST', 'application/json', { note: 'for Ann' }])
    fetch = answer(200, { invite: INVITE, link: LINK })
    await createInvite('   ')
    expect(sent(fetch)[3]).toEqual({})
  })

  it('revoke by id', async () => {
    const fetch = answer(200, { revoked: INVITE.id })
    expect(await revokeInvite(INVITE.id)).toEqual({ ok: true, value: INVITE.id })
    expect(sent(fetch)).toEqual([
      `/account/users/invites/${INVITE.id}`,
      'POST',
      'application/json',
      { intent: 'revoke' },
    ])
  })

  it('map quota, closed and every other code, and read a missing link or row as failed', async () => {
    for (const code of ['quota', 'closed', 'not_found', 'invalid', 'signed_out', 'failed'] as const) {
      answer(409, { error: code })
      expect(await createInvite('')).toEqual({ ok: false, problem: code })
      answer(404, { error: code })
      expect(await revokeInvite(INVITE.id)).toEqual({ ok: false, problem: code })
    }
    answer(200, { invite: INVITE })
    expect(await createInvite('')).toEqual({ ok: false, problem: 'failed' })
    answer(200, { invite: { note: 'no id' }, link: LINK })
    expect(await createInvite('')).toEqual({ ok: false, problem: 'failed' })
    answer(200, { revoked: 7 })
    expect(await revokeInvite(INVITE.id)).toEqual({ ok: false, problem: 'failed' })
  })

  it('read a network failure as failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    )
    expect(await createInvite('')).toEqual({ ok: false, problem: 'failed' })
    expect(await revokeInvite(INVITE.id)).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('the problems', () => {
  it('map every code the server answers', async () => {
    for (const code of ADMIN_PROBLEMS) {
      answer(code === 'signed_out' ? 401 : 409, { error: code })
      expect(await changeUser('ada', { intent: 'disable' })).toEqual({ ok: false, problem: code })
    }
  })

  it('read an unknown code, a 500, a body that isn’t JSON and an answer without its value as failed', async () => {
    answer(418, { error: 'teapot' })
    expect(await addUser('ada', 'member')).toEqual({ ok: false, problem: 'failed' })
    answer(500, 'Internal Server Error')
    expect(await deleteUser('ada')).toEqual({ ok: false, problem: 'failed' })
    answer(200, { nothing: true })
    expect(await changeUser('ada', { intent: 'enable' })).toEqual({ ok: false, problem: 'failed' })
    answer(200, { deleted: true })
    expect(await deleteUser('ada')).toEqual({ ok: false, problem: 'failed' })
  })

  it('read a network failure as failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    )
    expect(await addUser('ada', 'member')).toEqual({ ok: false, problem: 'failed' })
  })
})

describe('problemText', () => {
  it('has copy for every problem, and says what is wrong with a username on the add form', () => {
    for (const code of ADMIN_PROBLEMS) expect(problemText(code, 'change')).toMatch(/\.$/)
    expect(problemText('invalid', 'add')).toBe(
      'Usernames are 3–32 characters: a–z, 0–9, _ and -, starting with a letter or digit.',
    )
    expect(problemText('invalid', 'change')).toBe('That request wasn’t understood. Reload and try again.')
    expect(problemText('last_admin', 'change')).toBe(
      'Folio needs at least one admin. Make someone else an admin first.',
    )
    expect(problemText('quota', 'change')).toBe('There are already 20 open invites. Revoke one first.')
    expect(problemText('closed', 'change')).toBe('Sign-up is turned off on this server, so invites can’t be made.')
  })
})

describe('the menu items', () => {
  it('send the change each names', () => {
    expect(changeFor('make-admin')).toEqual({ intent: 'role', role: 'admin' })
    expect(changeFor('make-member')).toEqual({ intent: 'role', role: 'member' })
    for (const action of ['reset-password', 'unlock', 'sign-out', 'disable', 'enable'] as const)
      expect(changeFor(action)).toEqual({ intent: action })
  })

  it('have a label and a status line each', () => {
    expect(Object.keys(ACTION_LABELS)).toHaveLength(8)
    expect(ACTION_LABELS.delete).toBe('Delete…')
    const lines = (['add', ...Object.keys(ACTION_LABELS)] as Parameters<typeof doneText>[0][]).map((a) =>
      doneText(a, 'ada'),
    )
    expect(lines).toEqual([
      'ada was added.',
      'ada’s password was reset.',
      'ada is now an admin.',
      'ada is now a member.',
      'ada was unlocked.',
      'ada was signed out everywhere.',
      'ada was disabled.',
      'ada was enabled.',
      'ada was deleted.',
    ])
  })
})
