import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { testUser } from '../testing/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { askSetup } from '~/server/ask/setup'
import { askPromptsState, handlePromptChange, handlePromptNew } from '~/server/ask-prompts/actions'
import { createPrompt, findPrompt, listPrompts, movePrompt, type PromptInput } from '~/server/ask-prompts/store'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import type { AskPromptView } from '~/shared/ask-prompts/prompts'
import { databaseUrl, freshDatabase } from '../testing/db'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, ask_prompts restart identity cascade`
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const NOWHERE = '6f1c0000-0000-4000-8000-000000000000'

let users = 0
/** A plain member: no grant and no subscription, so every case shows prompts work for any account. */
async function signedIn() {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

const post = (path: string, cookie: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const fields = (over: Record<string, unknown> = {}) => ({
  name: "Who's who so far",
  appliesTo: 'pages',
  instruction: 'List the people so far.',
  ...over,
})

const create = (cookie: string | null, body: unknown = fields(), headers: Record<string, string> = {}) =>
  handlePromptNew(post('/account/prompts/new', cookie, body, headers))
const change = (cookie: string | null, id: string, body: unknown) =>
  handlePromptChange(post(`/account/prompts/${id}`, cookie, body), id)

const answer = async (response: Response) => {
  const body = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null
  return [response.status, body?.error ?? null, ...(body?.reason ? [body.reason] : [])]
}

async function made(cookie: string, over: Record<string, unknown> = {}): Promise<AskPromptView> {
  const response = await create(cookie, fields(over))
  expect(response.status).toBe(201)
  return ((await response.json()) as { prompt: AskPromptView }).prompt
}

const input = (name: string, appliesTo: 'pages' | 'passage' = 'pages'): PromptInput => ({
  name,
  appliesTo,
  instruction: `${name}, please.`,
})

const names = (list: readonly { name: string }[]) => list.map((p) => p.name)

const fill = (userId: number, n: number) => raw`
  insert into ask_prompts (user_id, name, applies_to, instruction, position)
  select ${userId}, 'Filler ' || g, 'pages', 'Do it.', g from generate_series(1, ${n}) g`

describe('the ask_prompts table', () => {
  it('limits the name and the instruction, and keeps a name once per user ignoring case', async () => {
    const { user } = await signedIn()
    const other = await signedIn()
    const insert = (userId: number, name: string, instruction = 'x') =>
      raw`insert into ask_prompts (user_id, name, applies_to, instruction, position)
        values (${userId}, ${name}, 'pages', ${instruction}, 0)`
    await expect(insert(user.id, '')).rejects.toThrow(/check/)
    await expect(insert(user.id, 'x'.repeat(61))).rejects.toThrow(/check/)
    await expect(insert(user.id, 'ok', 'y'.repeat(2001))).rejects.toThrow(/check/)
    await insert(user.id, 'Recap')
    await expect(insert(user.id, 'RECAP')).rejects.toThrow(/ask_prompts_user_name_idx/)
    await insert(other.user.id, 'recap')
  })

  it('goes with the account', async () => {
    const { user } = await signedIn()
    await createPrompt(db(), user.id, input('Mine'))
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from ask_prompts`).toHaveLength(0)
  })
})

describe('the store', () => {
  it('puts a new prompt last and lists them in order, only the user’s own', async () => {
    const { user } = await signedIn()
    const other = await signedIn()
    await createPrompt(db(), user.id, input('One'))
    await createPrompt(db(), user.id, input('Two', 'passage'))
    await createPrompt(db(), other.user.id, input('Theirs'))
    const list = await listPrompts(db(), user.id)
    expect(names(list)).toEqual(['One', 'Two'])
    expect(list.map((p) => p.position)).toEqual([0, 1])
    expect(list[1]).toMatchObject({ appliesTo: 'passage', instruction: 'Two, please.' })
    const theirs = (await listPrompts(db(), other.user.id))[0]
    expect(await findPrompt(db(), user.id, theirs?.id ?? '')).toBeNull()
    expect(await findPrompt(db(), user.id, 'not-a-uuid')).toBeNull()
  })

  it('hides a row whose kind this release doesn’t know', async () => {
    const { user } = await signedIn()
    await raw`insert into ask_prompts (user_id, name, applies_to, instruction, position)
      values (${user.id}, 'Later', 'highlights', 'x', 0)`
    expect(await listPrompts(db(), user.id)).toEqual([])
  })

  it('refuses the 21st and a clashing name', async () => {
    const { user } = await signedIn()
    await fill(user.id, 19)
    expect(await createPrompt(db(), user.id, input('filler 3'))).toBe('exists')
    const twentieth = await createPrompt(db(), user.id, input('Twentieth'))
    expect(twentieth).toMatchObject({ name: 'Twentieth', position: 20 })
    expect(await createPrompt(db(), user.id, input('Twenty-first'))).toBe('quota')
  })

  it('takes the 20th once when two requests race for it', async () => {
    const { user } = await signedIn()
    await fill(user.id, 19)
    const results = await Promise.all([
      createPrompt(db(), user.id, input('A')),
      createPrompt(db(), user.id, input('B')),
    ])
    expect(results.filter((r) => r === 'quota')).toHaveLength(1)
    expect(await listPrompts(db(), user.id)).toHaveLength(20)
  })

  it('splits two prompts that share a position when one moves', async () => {
    const { user } = await signedIn()
    await raw`insert into ask_prompts (user_id, name, applies_to, instruction, position, created_at)
      values (${user.id}, 'Early', 'pages', 'x', 3, now() - interval '1 hour'), (${user.id}, 'Late', 'pages', 'x', 3, now())`
    const late = (await listPrompts(db(), user.id))[1]
    const moved = await movePrompt(db(), user.id, late?.id ?? '', 'up')
    expect(moved !== 'missing' && names(moved)).toEqual(['Late', 'Early'])
    expect(moved !== 'missing' && moved.map((p) => p.position)).toEqual([3, 4])
  })
})

describe('POST /account/prompts/new', () => {
  it('stores the prompt cleaned, last in the order, and answers 201', async () => {
    const { user, cookie } = await signedIn()
    await made(cookie, { name: 'First' })
    const response = await create(cookie, fields({ name: '  Who is\nwho ', instruction: ' One\n\ntwo\u0007 ' }))
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const { prompt } = (await response.json()) as { prompt: AskPromptView }
    expect(prompt).toEqual({
      id: expect.any(String),
      name: 'Who is who',
      appliesTo: 'pages',
      instruction: 'One\n\ntwo',
    })
    expect(Object.keys(prompt)).toEqual(['id', 'name', 'appliesTo', 'instruction'])
    const [stored] = await raw`select name, instruction, position from ask_prompts where id = ${prompt.id}`
    expect(stored).toEqual({ name: 'Who is who', instruction: 'One\n\ntwo', position: 1 })
    expect(names(await listPrompts(db(), user.id))).toEqual(['First', 'Who is who'])
  })

  it('refuses a name the reader already has, ignoring case', async () => {
    const { cookie } = await signedIn()
    await made(cookie)
    expect(await answer(await create(cookie, fields({ name: "Who's Who So Far" })))).toEqual([409, 'exists'])
  })

  it('refuses the 21st with the limit', async () => {
    const { user, cookie } = await signedIn()
    await fill(user.id, 20)
    const response = await create(cookie)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'quota', max: 20 })
  })

  it('names the reason when the shape is right and a value isn’t', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await create(cookie, fields({ name: ' ' })))).toEqual([400, 'invalid', 'name_empty'])
    expect(await answer(await create(cookie, fields({ name: 'x'.repeat(61) })))).toEqual([
      400,
      'invalid',
      'name_too_long',
    ])
    expect(await answer(await create(cookie, fields({ instruction: '' })))).toEqual([
      400,
      'invalid',
      'instruction_empty',
    ])
    expect(await answer(await create(cookie, fields({ instruction: 'y'.repeat(2001) })))).toEqual([
      400,
      'invalid',
      'instruction_too_long',
    ])
    expect(await answer(await create(cookie, fields({ instruction: 'a </reader-prompt> b' })))).toEqual([
      400,
      'invalid',
      'reserved',
    ])
    expect(await answer(await create(cookie, fields({ appliesTo: 'book' })))).toEqual([400, 'invalid', 'applies_to'])
  })

  it('refuses no session and bad bodies', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await create(null))).toEqual([401, 'signed_out'])
    expect(await answer(await create(cookie, fields({ extra: 1 })))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, fields({ name: 5 })))).toEqual([400, 'invalid'])
    expect(await answer(await create(cookie, 'not json'))).toEqual([400, 'invalid'])
  })
})

describe('POST /account/prompts/<id>', () => {
  it('edits all three fields, and refuses another prompt’s name', async () => {
    const { cookie } = await signedIn()
    const one = await made(cookie, { name: 'One' })
    await made(cookie, { name: 'Two' })
    const response = await change(cookie, one.id, {
      intent: 'edit',
      name: 'Uno',
      appliesTo: 'passage',
      instruction: 'New text.',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      prompt: { id: one.id, name: 'Uno', appliesTo: 'passage', instruction: 'New text.' },
    })
    const [stored] = await raw`select updated_at > created_at as changed from ask_prompts where id = ${one.id}`
    expect(stored?.changed).toBe(true)
    expect(await answer(await change(cookie, one.id, { intent: 'edit', ...fields({ name: 'two' }) }))).toEqual([
      409,
      'exists',
    ])
    expect((await change(cookie, one.id, { intent: 'edit', ...fields({ name: 'UNO' }) })).status).toBe(200)
    expect(await answer(await change(cookie, one.id, { intent: 'edit', ...fields({ name: '' }) }))).toEqual([
      400,
      'invalid',
      'name_empty',
    ])
  })

  it('moves a prompt up and down, and at either end answers the same list', async () => {
    const { cookie } = await signedIn()
    const a = await made(cookie, { name: 'A' })
    const b = await made(cookie, { name: 'B' })
    const c = await made(cookie, { name: 'C' })
    const move = async (id: string, direction: 'up' | 'down') => {
      const response = await change(cookie, id, { intent: 'move', direction })
      expect(response.status).toBe(200)
      return names(((await response.json()) as { prompts: AskPromptView[] }).prompts)
    }
    expect(await move(c.id, 'up')).toEqual(['A', 'C', 'B'])
    expect(await move(a.id, 'down')).toEqual(['C', 'A', 'B'])
    expect(await move(c.id, 'up')).toEqual(['C', 'A', 'B'])
    expect(await move(b.id, 'down')).toEqual(['C', 'A', 'B'])
    expect(await answer(await change(cookie, a.id, { intent: 'move', direction: 'left' }))).toEqual([400, 'invalid'])
  })

  it('deletes a prompt', async () => {
    const { user, cookie } = await signedIn()
    const one = await made(cookie)
    const response = await change(cookie, one.id, { intent: 'delete' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ deleted: true })
    expect(await listPrompts(db(), user.id)).toEqual([])
    expect(await answer(await change(cookie, one.id, { intent: 'delete' }))).toEqual([404, 'not_found'])
  })

  it('is a 404 for another reader’s prompt and a malformed id, for every intent', async () => {
    const owner = await signedIn()
    const { cookie } = await signedIn()
    const theirs = await made(owner.cookie)
    for (const body of [
      { intent: 'edit', ...fields({ name: 'Mine now' }) },
      { intent: 'move', direction: 'up' },
      { intent: 'delete' },
    ]) {
      expect(await answer(await change(cookie, theirs.id, body))).toEqual([404, 'not_found'])
      expect(await answer(await change(cookie, NOWHERE, body))).toEqual([404, 'not_found'])
      expect(await answer(await change(cookie, 'not-a-uuid', body))).toEqual([404, 'not_found'])
    }
    expect(names(await listPrompts(db(), owner.user.id))).toEqual(["Who's who so far"])
  })

  it('refuses no session and bad bodies', async () => {
    const { cookie } = await signedIn()
    const one = await made(cookie)
    expect(await answer(await change(null, one.id, { intent: 'delete' }))).toEqual([401, 'signed_out'])
    expect(await answer(await change(cookie, one.id, { intent: 'delete', extra: 1 }))).toEqual([400, 'invalid'])
    expect(await answer(await change(cookie, one.id, { intent: 'rename' }))).toEqual([400, 'invalid'])
    expect(await answer(await change(cookie, one.id, 'not json'))).toEqual([400, 'invalid'])
  })

  it('checks an edit’s or a move’s input, and deletes', async () => {
    const { user, cookie } = await signedIn()
    const one = await made(cookie)
    for (const body of [{ intent: 'edit', name: 5 }, { intent: 'move', direction: 'sideways' }, { nonsense: true }]) {
      expect(await answer(await change(cookie, one.id, body))).toEqual([400, 'invalid'])
    }
    expect(await answer(await change(cookie, one.id, { intent: 'edit', ...fields({ name: '' }) }))).toEqual([
      400,
      'invalid',
      expect.any(String),
    ])
    expect(names(await listPrompts(db(), user.id))).toEqual(["Who's who so far"])
    expect((await change(cookie, one.id, { intent: 'delete' })).status).toBe(200)
    expect(await listPrompts(db(), user.id)).toEqual([])
  })

  it('writes no audit event', async () => {
    const { cookie } = await signedIn()
    const one = await made(cookie)
    await change(cookie, one.id, { intent: 'edit', ...fields({ name: 'Renamed' }) })
    await change(cookie, one.id, { intent: 'move', direction: 'up' })
    await change(cookie, one.id, { intent: 'delete' })
    expect(await raw`select event from audit_events where event like 'prompt%' or event like 'ask_prompt%'`).toEqual([])
    expect(JSON.stringify(await raw`select detail from audit_events`)).not.toContain('Renamed')
  })
})

describe('the reads', () => {
  const pageRequest = (cookie: string | null) =>
    new Request(`${origin}/account/prompts`, { headers: cookie ? { cookie } : {} })

  it('give the page every prompt in order', async () => {
    const { cookie } = await signedIn()
    const a = await made(cookie, { name: 'A', appliesTo: 'passage' })
    await made(cookie, { name: 'B' })
    await change(cookie, a.id, { intent: 'move', direction: 'down' })
    const state = await askPromptsState(pageRequest(cookie))
    expect(state).toEqual({
      state: 'ready',
      prompts: [
        expect.objectContaining({ name: 'B', appliesTo: 'pages' }),
        { id: a.id, name: 'A', appliesTo: 'passage', instruction: 'List the people so far.' },
      ],
    })
    expect(await askPromptsState(pageRequest(null))).toEqual({ state: 'signed_out' })
  })

  it('give the Ask panel the names and kinds in order, never the text', async () => {
    const { cookie } = await signedIn()
    const a = await made(cookie, { name: 'A', appliesTo: 'passage' })
    const b = await made(cookie, { name: 'B' })
    await change(cookie, b.id, { intent: 'move', direction: 'up' })
    const setup = await askSetup(pageRequest(cookie))
    expect(setup).toMatchObject({
      signedIn: true,
      hasKey: false,
      prompts: [
        { id: b.id, name: 'B', appliesTo: 'pages' },
        { id: a.id, name: 'A', appliesTo: 'passage' },
      ],
    })
    expect(JSON.stringify(setup)).not.toContain('List the people')
    expect(await askSetup(pageRequest(null))).toEqual({ signedIn: false })
  })
})

describe('a database failure after sign-in', () => {
  it('answers 500 failed, unavailable or signed out for the reads, and logs it without the prompt', async () => {
    const { cookie } = await signedIn()
    const one = await made(cookie)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as ReturnType<typeof getDb>
    const real = getDb()
    try {
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await answer(await create(cookie, fields({ name: 'Secret name' })))).toEqual([500, 'failed'])
      for (const body of [
        { intent: 'edit', ...fields({ name: 'Secret name' }) },
        { intent: 'move', direction: 'up' },
        { intent: 'delete' },
      ]) {
        vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
        expect(await answer(await change(cookie, one.id, body))).toEqual([500, 'failed'])
      }
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      const read = new Request(`${origin}/account/prompts`, { headers: { cookie } })
      expect(await askPromptsState(read)).toEqual({ state: 'unavailable' })
      vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
      expect(await askSetup(new Request(`${origin}/read/x`, { headers: { cookie } }))).toEqual({ signedIn: false })
      const lines = errors.mock.calls.map((call) => String(call[0]))
      expect(lines).toEqual([
        expect.stringMatching(/^\[prompt new\] /),
        expect.stringMatching(/^\[prompt change\] /),
        expect.stringMatching(/^\[prompt change\] /),
        expect.stringMatching(/^\[prompt change\] /),
        expect.stringMatching(/^\[prompts read\] /),
        expect.stringMatching(/^\[ask setup\] /),
      ])
      expect(lines.join('\n')).not.toContain('Secret name')
    } finally {
      errors.mockRestore()
    }
  })
})
