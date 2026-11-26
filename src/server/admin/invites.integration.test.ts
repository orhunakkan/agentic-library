import { afterAll, beforeEach, describe, expect, vi } from 'vitest'
import { type Config, getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { it, raw } from '../testing/db-test'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { adminOnly } from '~/server/admin/caller'
import { handleInviteChange, handleNewInvite, invitesForAdmin } from '~/server/admin/invites'
import { deleteAccount } from '~/server/admin/store'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession, type SessionUser } from '~/server/sessions'
import { signupPage } from '~/server/signup/actions'
import { createUser, type Role } from '~/server/users'

const config = getConfig() as { -readonly [K in keyof Config]: Config[K] }
const origin = config.appOrigin
const cookieName = config.cookieSecure ? '__Host-session' : 'session'
const HASH = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA'
const IP = '198.51.100.20'

afterAll(async () => {
  config.signup = 'invite'
  await closeDb()
})
beforeEach(async () => {
  config.signup = 'invite'
})

async function signedIn(username: string, role: Role = 'admin') {
  const user = await createUser(getDb(), username, HASH, role)
  const token = newSessionToken()
  await createSession(getDb(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

const request = (path: string, cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-real-ip': IP,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const make = (cookie: string | null, body: unknown = {}, headers?: Record<string, string>) =>
  handleNewInvite(request('/account/users/invites/new', cookie, body, headers))
const revoke = (cookie: string | null, id: string, body: unknown = { intent: 'revoke' }) =>
  handleInviteChange(request(`/account/users/invites/${id}`, cookie, body), id)

const answer = async (response: Response) => [
  response.status,
  response.status === 403 ? null : (((await response.json()) as { error?: string }).error ?? null),
]

const events = async (event: string) =>
  (
    await raw<{ user_id: string; detail: unknown }[]>`
    select user_id, detail from audit_events where event = ${event} order by id`
  ).map((e) => [Number(e.user_id), e.detail])

const tokenOf = (link: string) => new URL(link).searchParams.get('token') ?? ''

describe('making an invite', () => {
  it('refuses a signed-out visitor, a member, a bad body and a long note', async () => {
    const admin = await signedIn('orhun')
    const member = await signedIn('ann', 'member')
    expect(await answer(await make(null))).toEqual([401, 'signed_out'])
    expect(await answer(await make(member.cookie))).toEqual([404, 'not_found'])
    expect(await answer(await make(admin.cookie, '{'))).toEqual([400, 'invalid'])
    expect(await answer(await make(admin.cookie, { note: 'x'.repeat(61) }))).toEqual([400, 'invalid'])
    expect(await answer(await make(admin.cookie, { note: 'a', role: 'admin' }))).toEqual([400, 'invalid'])
    expect((await raw`select 1 from signup_tokens`).count).toBe(0)
  })

  it('answers the invite and its link once, and audits neither the note nor the token', async () => {
    const admin = await signedIn('orhun')
    const response = await make(admin.cookie, { note: '  for Ann ' })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { invite, link } = (await response.json()) as { invite: Record<string, unknown>; link: string }
    expect(link).toMatch(new RegExp(`^${origin}/signup\\?token=[A-Za-z0-9_-]{43}$`))
    expect(invite).toMatchObject({ note: 'for Ann', by: 'orhun' })
    const [row] = await raw<{ id: string; token_hash: Buffer; expires: boolean }[]>`
      select id, token_hash, expires_at between now() + interval '7 days' - interval '1 minute'
        and now() + interval '7 days' as expires
      from signup_tokens`
    expect(row?.id).toBe(invite.id)
    expect(row?.token_hash.equals(hashToken(tokenOf(link)))).toBe(true)
    expect(row?.expires).toBe(true)

    expect(await events('invite.created')).toEqual([
      [admin.user.id, { invite: invite.id, by: admin.user.id, note: true }],
    ])
    const trail = JSON.stringify(await raw`select detail from audit_events`)
    expect(trail).not.toContain('Ann')
    expect(trail).not.toContain(tokenOf(link))
  })

  it('records a missing note as none', async () => {
    const admin = await signedIn('orhun')
    expect((await make(admin.cookie)).status).toBe(200)
    expect(await events('invite.created')).toEqual([[admin.user.id, expect.objectContaining({ note: false })]])
  })

  it('stops at 20 open invites, and counts only the open ones', async () => {
    const admin = await signedIn('orhun')
    await raw`
      insert into signup_tokens (token_hash, kind, created_by, expires_at)
      select sha256(convert_to('invite-' || i, 'UTF8')), 'invite', ${admin.user.id}, now() + interval '7 days'
      from generate_series(1, 20) i`
    const full = await make(admin.cookie)
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'quota', max: 20 })
    await raw`update signup_tokens set used_at = now() where token_hash = sha256(convert_to('invite-1', 'UTF8'))`
    expect((await make(admin.cookie)).status).toBe(200)
  })

  it('is closed while sign-up is off', async () => {
    const admin = await signedIn('orhun')
    config.signup = 'off'
    expect(await answer(await make(admin.cookie))).toEqual([409, 'closed'])
  })

  it('answers failed when the database fails', async () => {
    const admin = await signedIn('orhun')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getDb)
      .mockReturnValueOnce(getDb())
      .mockImplementationOnce(() => {
        throw new Error('connect ECONNREFUSED')
      })
    expect(await answer(await make(admin.cookie))).toEqual([500, 'failed'])
  })
})

describe('revoking an invite', () => {
  it('ends the link, and refuses an unknown, used, expired or malformed id', async () => {
    const admin = await signedIn('orhun')
    const made = (await (await make(admin.cookie, { note: 'for Ann' })).json()) as {
      invite: { id: string }
      link: string
    }
    const page = () => signupPage(new Request(`${origin}/signup`), tokenOf(made.link))
    expect(await page()).toMatchObject({ state: 'ready', kind: 'invite' })

    expect(await answer(await revoke(admin.cookie, made.invite.id, { intent: 'delete' }))).toEqual([400, 'invalid'])
    const done = await revoke(admin.cookie, made.invite.id)
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({ revoked: made.invite.id })
    expect(await events('invite.revoked')).toEqual([[admin.user.id, { invite: made.invite.id, by: admin.user.id }]])
    expect(await page()).toEqual({ state: 'invalid' })
    expect(await answer(await revoke(admin.cookie, made.invite.id))).toEqual([404, 'not_found'])

    const used = (await (await make(admin.cookie)).json()) as { invite: { id: string } }
    await raw`update signup_tokens set used_at = now() where id = ${used.invite.id}`
    expect(await answer(await revoke(admin.cookie, used.invite.id))).toEqual([404, 'not_found'])
    const expired = (await (await make(admin.cookie)).json()) as { invite: { id: string } }
    await raw`update signup_tokens set expires_at = now() - interval '1 second' where id = ${expired.invite.id}`
    expect(await answer(await revoke(admin.cookie, expired.invite.id))).toEqual([404, 'not_found'])
    expect(await answer(await revoke(admin.cookie, '0b9d1f2e-3c4a-4b5c-8d6e-7f8091a2b3c4'))).toEqual([404, 'not_found'])

    vi.mocked(getDb).mockClear()
    expect(await answer(await revoke(admin.cookie, 'not-a-uuid'))).toEqual([404, 'not_found'])
    expect(getDb).toHaveBeenCalledTimes(1)
  })

  it('refuses a member, and a sign-up link’s id', async () => {
    const admin = await signedIn('orhun')
    const member = await signedIn('ann', 'member')
    const made = (await (await make(admin.cookie)).json()) as { invite: { id: string } }
    expect(await answer(await revoke(member.cookie, made.invite.id))).toEqual([404, 'not_found'])
    const [link] = await raw<{ id: string }[]>`
      insert into signup_tokens (token_hash, kind, email, expires_at)
      values (${hashToken('mailed')}, 'email', 'a@example.com', now() + interval '1 day') returning id`
    expect(await answer(await revoke(admin.cookie, link?.id ?? ''))).toEqual([404, 'not_found'])
  })

  it('answers failed when the database fails', async () => {
    const admin = await signedIn('orhun')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getDb)
      .mockReturnValueOnce(getDb())
      .mockImplementationOnce(() => {
        throw new Error('connect ECONNREFUSED')
      })
    expect(await answer(await revoke(admin.cookie, '0b9d1f2e-3c4a-4b5c-8d6e-7f8091a2b3c4'))).toEqual([500, 'failed'])
  })
})

describe('the Invites list', () => {
  it('shows pending invites only, newest first, with their maker; none while sign-up is off', async () => {
    const admin = await signedIn('orhun')
    const other = await signedIn('zed')
    await make(admin.cookie, { note: 'first' })
    await make(other.cookie, { note: 'second' })
    await make(admin.cookie, { note: 'used' })
    await make(admin.cookie, { note: 'revoked' })
    await raw`update signup_tokens set created_at = created_at + (interval '1 second' * (
      case note when 'first' then 1 when 'second' then 2 when 'used' then 3 else 4 end))`
    await raw`update signup_tokens set used_at = now() where note = 'used'`
    await raw`update signup_tokens set revoked_at = now() where note = 'revoked'`
    const list = await invitesForAdmin()
    expect(list.map((i) => [i.note, i.by])).toEqual([
      ['second', 'zed'],
      ['first', 'orhun'],
    ])
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(['by', 'createdAt', 'expiresAt', 'id', 'note'])
    config.signup = 'off'
    expect(await invitesForAdmin()).toEqual([])
  })

  it('drops a deleted maker’s invites', async () => {
    const admin = await signedIn('orhun')
    await signedIn('zed')
    await make(admin.cookie, { note: 'theirs' })
    await deleteAccount(getDb(), admin.user.id, { detail: { via: 'users page' } })
    expect(await invitesForAdmin()).toEqual([])
  })
})

describe('the admin gate', () => {
  it('lets an admin through and answers anyone else 404 not_found', async () => {
    const gate = (role: Role) => {
      const session: SessionUser = { userId: 1, username: 'orhun', role, expiresAt: new Date() }
      return adminOnly({ session, db: getDb(), via: 'cookie', tokenId: null })
    }
    expect(gate('admin')).toBeUndefined()
    const refused = gate('member')
    expect(refused && (await answer(refused))).toEqual([404, 'not_found'])
  })

  it('answers a member 404 not_found before their body is read', async () => {
    const member = await signedIn('ann', 'member')
    const sent = request('/account/users/invites/new', member.cookie, 'not even json')
    expect(await answer(await handleNewInvite(sent))).toEqual([404, 'not_found'])
    expect(sent.bodyUsed).toBe(false)
  })
})
