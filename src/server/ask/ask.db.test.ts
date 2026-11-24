import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { saveKey } from '~/server/api-keys'
import { handleAsk } from '~/server/ask/ask'
import { createPrompt } from '~/server/ask-prompts/store'
import { recordEvent } from '~/server/audit'
import { refFor } from '~/server/books/ref'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { finishImport, startImport, storeChapter } from '~/server/user-books'
import { setAiModel } from '~/server/users'
import { privateBookSlug } from '~/shared/content/book-slug'
import type { ChapterBook } from '~/shared/content/schema'
import { bookPages } from '~/shared/highlights/page-text'
import { anthropicStub, STUB_KEYS, STUB_RIGHT_ANSWER } from '../../../tests/e2e/support/anthropic-stub'
import { NO_DETAILS } from '../../shared/import/details.ts'
import { databaseUrl, freshDatabase } from '../testing/db'
import { testUser } from '../testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, login_attempts, api_keys, audit_events, user_books, ask_prompts restart identity cascade`
})

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const key = (ending = '0000') => `sk-ant-test-valid-${'x'.repeat(16)}${ending}`
const stubFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  anthropicStub(new Request(input, init))) as typeof fetch

let users = 0
async function reader({ withKey = key() as string | null } = {}) {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  if (withKey) await saveKey(db(), user.id, 'anthropic', withKey)
  return { user, cookie: `${cookieName}=${token}` }
}

const QUESTION = 'Why is Mr. Darcy so proud at the assembly?'
const body = (over: Record<string, unknown> = {}) => ({
  position: { chapter: 'chapter-3', page: 2 },
  wholeBook: false,
  question: QUESTION,
  quote: null,
  history: [],
  ...over,
})

function ask(slug: string, cookie: string | null, payload: unknown = body(), headers: Record<string, string> = {}) {
  return handleAsk(
    new Request(`${origin}/read/${slug}/ask`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
    slug,
    { fetch: stubFetch },
  )
}

type Event = { type: string; [field: string]: unknown }
const events = async (response: Response): Promise<Event[]> =>
  (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event)

async function askedEvents(userId: number) {
  for (let i = 0; i < 50; i++) {
    const rows = await raw<{ detail: Record<string, unknown> }[]>`
      select detail from audit_events where event = 'book.asked' and user_id = ${userId} order by id`
    if (rows.length) return rows.map((r) => r.detail)
    await new Promise((r) => setTimeout(r, 20))
  }
  return []
}

describe('POST /read/<book>/ask', () => {
  it('streams an answer with a citation that links to the page it came from', async () => {
    const { user, cookie } = await reader()
    const response = await ask('pride-and-prejudice', cookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const out = await events(response)
    expect(out.filter((e) => e.type === 'text').map((e) => e.text)).toEqual([
      expect.stringMatching(/^I can see \d+ pages of the book\. $/),
      'Your page says so',
      '.\n\nFor example:\n\n```js\nconst answer = 42\n```',
    ])
    expect(out.find((e) => e.type === 'citation')).toEqual({
      type: 'citation',
      pageHref: '/read/pride-and-prejudice/chapter-3/2',
      label: 'Ch. 3 · p. 2',
      citedText: expect.any(String),
    })
    expect(out.at(-1)).toEqual({ type: 'done', stop: 'end_turn' })
    const types = out.map((e) => (e.type === 'text' ? e.text : e.type))
    expect(types.indexOf('citation')).toBe(types.indexOf('Your page says so') + 1)

    const [audit] = await askedEvents(user.id)
    expect(audit).toEqual({
      book: 'pride-and-prejudice',
      model: 'claude-opus-5-5',
      servedBy: 'claude-opus-5-5',
      inputTokens: 120,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 64,
      wholeBook: false,
      highlights: 0,
      action: null,
      items: null,
      stop: 'end_turn',
    })
    expect(JSON.stringify(await raw`select * from audit_events`)).not.toContain('proud')
    const [row] = await raw<{ last_used_at: Date | null }[]>`select last_used_at from api_keys`
    expect(row?.last_used_at).not.toBeNull()
  })

  it('sends the pages up to the reader, or the whole book with the switch on', async () => {
    const { cookie } = await reader()
    const pages = async (payload: unknown) =>
      Number(
        /I can see (\d+) pages/.exec(
          String((await events(await ask('pride-and-prejudice', cookie, payload)))[0]?.text),
        )?.[1],
      )
    const early = await pages(body({ position: { chapter: 'chapter-1', page: 1 } }))
    const later = await pages(body())
    const whole = await pages(body({ wholeBook: true }))
    expect(early).toBe(1)
    expect(later).toBeGreaterThan(early)
    expect(whole).toBeGreaterThan(later)
    expect(whole).toBe(216)
  })

  it('uses the model the reader chose', async () => {
    const { user, cookie } = await reader()
    await setAiModel(db(), user.id, 'claude-haiku-5-5')
    await events(await ask('pride-and-prejudice', cookie))
    expect((await askedEvents(user.id))[0]).toMatchObject({ model: 'claude-haiku-5-5', servedBy: 'claude-haiku-5-5' })
  })

  it('answers for a paged book by printed page', async () => {
    const { cookie } = await reader()
    const response = await ask('pride-and-prejudice', cookie, body({ position: { printedPage: 12 } }))
    expect([response.status, await response.json()]).toEqual([400, { error: 'invalid' }])
  })

  describe('refuses before calling Anthropic', () => {
    it('without a session (401)', async () => {
      const signedOut = await ask('pride-and-prejudice', null)
      expect([signedOut.status, await signedOut.json()]).toEqual([401, { error: 'signed_out' }])
    })

    it('for a book that does not exist (404)', async () => {
      const { cookie } = await reader()
      const response = await ask('no-such-book', cookie)
      expect([response.status, await response.json()]).toEqual([404, { error: 'not_found' }])
    })

    it('for a bad body or a page the book does not have (400), or a body over its 128 KB cap (413)', async () => {
      const { cookie } = await reader()
      for (const payload of [
        'not json',
        body({ question: '' }),
        body({ extra: true }),
        body({ position: { chapter: 'chapter-3', page: 999 } }),
        body({ position: { chapter: 'nope', page: 1 } }),
      ]) {
        const response = await ask('pride-and-prejudice', cookie, payload)
        expect([response.status, await response.json()], JSON.stringify(payload)).toEqual([400, { error: 'invalid' }])
      }
      const huge = await ask('pride-and-prejudice', cookie, body({ question: 'x'.repeat(200_000) }))
      expect([huge.status, await huge.json()]).toEqual([413, { error: 'invalid' }])
    })

    it('without a saved key (409)', async () => {
      const { cookie } = await reader({ withKey: null })
      const response = await ask('pride-and-prejudice', cookie)
      expect([response.status, await response.json()]).toEqual([409, { error: 'no_key' }])
    })

    it('over 60 questions an hour, counted from book.asked events, saying when to try again (429)', async () => {
      const { user, cookie } = await reader()
      for (let i = 0; i < 59; i++) await recordEvent(db(), 'book.asked', { userId: user.id })
      expect((await ask('pride-and-prejudice', cookie)).status).toBe(200)
      await askedEvents(user.id)
      await new Promise((r) => setTimeout(r, 50))
      const limited = await ask('pride-and-prejudice', cookie)
      const json = (await limited.json()) as { error: string; retryAt: string }
      expect([limited.status, json.error]).toEqual([429, 'limit'])
      const wait = new Date(json.retryAt).getTime() - Date.now()
      expect(wait).toBeGreaterThan(59 * 60_000)
      expect(wait).toBeLessThanOrEqual(60 * 60_000)
    })
  })

  describe('a private book', () => {
    async function withBook() {
      const owner = await reader()
      const start = await startImport(db(), owner.user.id, {
        title: 'My Notes',
        author: 'Ada',
        language: 'en',
        details: NO_DETAILS,
        chapterCount: 1,
      })
      if (!start.ok) throw new Error('could not start')
      await storeChapter(db(), owner.user.id, start.id, 0, {
        title: 'Only',
        pages: ['<p>First page.</p>', '<p>Second page.</p>'],
      })
      expect(await finishImport(db(), owner.user.id, start.id, null)).toBe('ok')
      return { owner, slug: privateBookSlug(start.id) }
    }

    it('can be asked about by its owner', async () => {
      const { owner, slug } = await withBook()
      const out = await events(await ask(slug, owner.cookie, body({ position: { chapter: 'only', page: 2 } })))
      expect(out.find((e) => e.type === 'citation')).toMatchObject({
        pageHref: `/read/${slug}/only/2`,
        label: 'Ch. 1 · p. 2',
        citedText: 'Second page.',
      })
      expect((await askedEvents(owner.user.id))[0]).toMatchObject({ book: slug })
    })

    it('is a 404 for anyone else, signed in with a key or not', async () => {
      const { slug } = await withBook()
      const other = await reader()
      const response = await ask(slug, other.cookie, body({ position: { chapter: 'only', page: 1 } }))
      expect([response.status, await response.json()]).toEqual([404, { error: 'not_found' }])
      expect((await ask(slug, null)).status).toBe(401)
    })
  })

  describe('maps every Anthropic failure to its code', () => {
    const cases: [string, string][] = [
      [STUB_KEYS.rejected, 'key_rejected'],
      [STUB_KEYS.billing, 'billing'],
      [STUB_KEYS.overloaded, 'busy'],
      [STUB_KEYS.rateLimited, 'busy'],
      [STUB_KEYS.tooLong, 'too_long'],
      [STUB_KEYS.midStreamError, 'busy'],
    ]
    for (const [ending, code] of cases) {
      it(`${ending} → ${code}`, async () => {
        const { user, cookie } = await reader({ withKey: key(ending) })
        const out = await events(await ask('pride-and-prejudice', cookie))
        expect(out.at(-1)).toEqual({ type: 'error', code })
        expect((await askedEvents(user.id))[0]).toMatchObject({ error: code })
      })
    }

    it('a refusal ends with stop "refusal"', async () => {
      const { user, cookie } = await reader({ withKey: key(STUB_KEYS.refusal) })
      const out = await events(await ask('pride-and-prejudice', cookie))
      expect(out).toEqual([{ type: 'done', stop: 'refusal' }])
      expect((await askedEvents(user.id))[0]).toMatchObject({ stop: 'refusal' })
    })
  })

  it('aborts the upstream call when the browser goes away, and audits it as stopped', async () => {
    const { user, cookie } = await reader({ withKey: key(STUB_KEYS.slow) })
    const before = ((await (await anthropicStub(new Request('http://stub/stats'))).json()) as { aborted: number })
      .aborted
    const response = await ask('pride-and-prejudice', cookie)
    const reader_ = response.body?.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    while (!seen.includes('word2')) seen += decoder.decode((await reader_?.read())?.value)
    await reader_?.cancel()
    const [audit] = await askedEvents(user.id)
    expect(audit).toMatchObject({ error: 'stopped' })
    const after = ((await (await anthropicStub(new Request('http://stub/stats'))).json()) as { aborted: number })
      .aborted
    expect(after).toBe(before + 1)
  })
})

describe('Ask with the reader’s highlights', () => {
  const pride = bookPages(
    JSON.parse(readFileSync('tests/e2e/content/books/pride-and-prejudice.json', 'utf8')) as ChapterBook,
  )
  const book = refFor('pride-and-prejudice')

  async function mark(userId: number, chapter: string, page: number, note: string | null = null) {
    const p = pride.find((x) => x.chapterSlug === chapter && x.page === page)
    if (!p) throw new Error('no such page')
    const exact = p.text.slice(0, 40)
    await raw`
      insert into highlights
        (user_id, book_slug, user_book_id, chapter, page, start_offset, end_offset, exact, prefix, suffix, color, note)
      values (${userId}, ${book.slug}, null, ${chapter}, ${page}, 0, 40, ${exact}, '', ${p.text.slice(40, 72)},
        'yellow', ${note})`
    return exact
  }

  it('sends the chapter’s highlights up to the reader’s page, never a later one or another user’s', async () => {
    const { user, cookie } = await reader()
    const other = await reader()
    const before = await mark(user.id, 'chapter-3', 1, 'My own note.')
    const here = await mark(user.id, 'chapter-3', 2)
    const later = await mark(user.id, 'chapter-3', 3)
    const elsewhere = await mark(user.id, 'chapter-4', 1)
    await mark(other.user.id, 'chapter-3', 1, 'Someone else’s note.')

    const sent: string[] = []
    const capture = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST') sent.push(await request.clone().text())
      return anthropicStub(request)
    }) as typeof fetch
    const askWith = (payload: unknown) =>
      handleAsk(
        new Request(`${origin}/read/pride-and-prejudice/ask`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json', cookie },
          body: JSON.stringify(payload),
        }),
        'pride-and-prejudice',
        { fetch: capture },
      )

    const first = await events(await askWith(body({ highlights: true })))
    expect(String(first[0]?.text)).toMatch(/^I can see \d+ pages of the book and 2 of your highlights\. $/)
    const question = JSON.parse(sent[0] ?? '{}').messages.at(-1).content as string
    expect(question.match(/<highlight /g)).toHaveLength(2)
    expect(question).toContain(before)
    expect(question).toContain(here)
    expect(question).toContain('My own note.')
    expect(question).toContain('<highlight page="Ch. 3 · p. 2">')
    expect(question).not.toContain(later)
    expect(question).not.toContain(elsewhere)
    expect(question).not.toContain('Someone else')

    const whole = await events(await askWith(body({ highlights: true, wholeBook: true })))
    expect(String(whole[0]?.text)).toContain('and 3 of your highlights')
    const plain = await events(await askWith(body()))
    expect(String(plain[0]?.text)).not.toContain('highlights')
    let audits = await askedEvents(user.id)
    for (let i = 0; i < 50 && audits.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 20))
      audits = await askedEvents(user.id)
    }
    expect(audits.map((a) => a.highlights)).toEqual([2, 3, 0])
    expect(JSON.stringify(audits)).not.toContain('My own note')
  })
})

describe('Ask with a button’s action', () => {
  const PASSAGE = 'It is a truth universally acknowledged.'

  function capturing() {
    const sent: { messages: { content: unknown }[] }[] = []
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST') sent.push(JSON.parse(await request.clone().text()))
      return anthropicStub(request)
    }) as typeof globalThis.fetch
    return { sent, fetch }
  }
  const askWith = (cookie: string, payload: unknown, fetch: typeof globalThis.fetch) =>
    handleAsk(
      new Request(`${origin}/read/pride-and-prejudice/ask`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie },
        body: JSON.stringify(payload),
      }),
      'pride-and-prejudice',
      { fetch },
    )

  it('streams a question asked by voice as a typed one, and audits spoken: true without its text', async () => {
    const { user, cookie } = await reader()
    const out = await events(await ask('pride-and-prejudice', cookie, body({ spoken: true })))
    expect(String(out[0]?.text)).toMatch(/^I can see \d+ pages of the book\. $/)
    expect(out.at(-1)).toEqual({ type: 'done', stop: 'end_turn' })
    const [audit] = await askedEvents(user.id)
    expect(audit).toMatchObject({ spoken: true, action: null, stop: 'end_turn' })
    expect(JSON.stringify(await raw`select * from audit_events`)).not.toContain('proud')
  })

  it('refuses spoken with an action, a saved prompt or the highlights, and any value but true (400)', async () => {
    const { cookie } = await reader()
    const refused = [
      body({ spoken: true, action: 'summary', question: 'Summarise this chapter so far.' }),
      body({ spoken: true, prompt: '0193a6f0-7c2e-7000-8000-000000000001' }),
      body({ spoken: true, highlights: true }),
      body({ spoken: false }),
      body({ spoken: 'yes' }),
    ]
    for (const payload of refused) {
      const response = await ask('pride-and-prejudice', cookie, payload)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid' })
    }
  })

  it('explains a passage, and audits the action as a code', async () => {
    const { user, cookie } = await reader()
    const out = await events(
      await ask(
        'pride-and-prejudice',
        cookie,
        body({ question: 'Explain this passage in plain words.', quote: PASSAGE, action: 'explain' }),
      ),
    )
    expect(String(out[0]?.text)).toMatch(/the passage you selected\. Request: explain\. $/)
    expect(out.at(-1)).toEqual({ type: 'done', stop: 'end_turn' })
    const [audit] = await askedEvents(user.id)
    expect(audit).toMatchObject({ action: 'explain', stop: 'end_turn' })
    expect(JSON.stringify(audit)).not.toContain('truth')
  })

  it('asks what a looked-up word means in its sentence (define), and audits it', async () => {
    const { user, cookie } = await reader()
    const { sent, fetch } = capturing()
    const out = await events(
      await askWith(
        cookie,
        body({ question: 'What does “universally” mean here?', quote: PASSAGE, action: 'define' }),
        fetch,
      ),
    )
    expect(String(out[0]?.text)).toContain('Request: define.')
    const question = sent[0]?.messages.at(-1)?.content as string
    expect(question).toContain('<request kind="define">')
    expect(question).toContain('<passage>')
    const [audit] = await askedEvents(user.id)
    expect(audit).toMatchObject({ action: 'define' })
  })

  it('summarises the whole chapter with the whole book, with the same first message as a plain question', async () => {
    const { cookie } = await reader()
    const { sent, fetch } = capturing()
    const summary = await events(
      await askWith(cookie, body({ question: 'Summarise this chapter.', wholeBook: true, action: 'summary' }), fetch),
    )
    expect(String(summary[0]?.text)).toContain('Request: summary.')
    await events(await askWith(cookie, body({ wholeBook: true }), fetch))
    const [withAction, plain] = sent
    const question = withAction?.messages.at(-1)?.content as string
    expect(question).toContain('<request kind="summary">')
    expect(question).toContain('Summarise the whole of the current chapter, from its start to its end')
    expect(question).not.toContain("up to the reader's page:")
    expect(withAction?.messages[0]).toEqual(plain?.messages[0])
    expect(plain?.messages.at(-1)?.content).not.toContain('<request')
  })

  it('audits a recap as recap and a typed question as null', async () => {
    const { user, cookie } = await reader()
    const recap = await events(
      await ask('pride-and-prejudice', cookie, body({ question: 'Recap the book so far.', action: 'recap' })),
    )
    expect(String(recap[0]?.text)).toContain('Request: recap.')
    await askedEvents(user.id)
    await events(await ask('pride-and-prejudice', cookie))
    let audits = await askedEvents(user.id)
    for (let i = 0; i < 50 && audits.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 20))
      audits = await askedEvents(user.id)
    }
    expect(audits.map((a) => a.action)).toEqual(['recap', null])
  })

  it('refuses an action that does not fit the body (400) before calling Anthropic or auditing', async () => {
    const { user, cookie } = await reader()
    const { sent, fetch } = capturing()
    for (const payload of [
      body({ action: 'explain' }),
      body({ action: 'define' }),
      body({ action: 'summary', quote: PASSAGE }),
      body({ action: 'recap', highlights: true }),
    ]) {
      const response = await askWith(cookie, payload, fetch)
      expect([response.status, await response.json()], JSON.stringify(payload)).toEqual([400, { error: 'invalid' }])
    }
    expect(sent).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 50))
    expect(await raw`select 1 from audit_events where event = 'book.asked' and user_id = ${user.id}`).toHaveLength(0)
  })
})

describe('Ask with a saved prompt', () => {
  const PASSAGE = 'It is a truth universally acknowledged.'
  const INSTRUCTION = 'List the people who have come up so far, one line each.\nUse only the pages I have read.'

  function capturing() {
    const sent: { system: unknown; messages: { content: unknown }[] }[] = []
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST') sent.push(JSON.parse(await request.clone().text()))
      return anthropicStub(request)
    }) as typeof globalThis.fetch
    return { sent, fetch }
  }
  const askWith = (cookie: string, payload: unknown, fetch: typeof globalThis.fetch) =>
    handleAsk(
      new Request(`${origin}/read/pride-and-prejudice/ask`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie },
        body: JSON.stringify(payload),
      }),
      'pride-and-prejudice',
      { fetch },
    )
  async function saved(userId: number, name: string, appliesTo: 'pages' | 'passage', instruction = INSTRUCTION) {
    const row = await createPrompt(db(), userId, { name, appliesTo, instruction })
    if (typeof row === 'string') throw new Error(row)
    return row.id
  }
  const run = (prompt: string, over: Record<string, unknown> = {}) => body({ question: 'Who’s who', prompt, ...over })

  it('sends the instruction in the reader’s own frame, with the stored name as the question', async () => {
    const { user, cookie } = await reader()
    const id = await saved(user.id, 'Who is who so far', 'pages')
    const { sent, fetch } = capturing()
    const out = await events(await askWith(cookie, run(id), fetch))
    expect(String(out[0]?.text)).toMatch(
      /^I can see \d+ pages of the book\. Prompt: List the people who have come up so far,\. $/,
    )
    expect(out.find((e) => e.type === 'citation')).toMatchObject({ pageHref: '/read/pride-and-prejudice/chapter-3/2' })
    expect(out.at(-1)).toEqual({ type: 'done', stop: 'end_turn' })
    await events(await askWith(cookie, body(), fetch))
    const [prompted, typed] = sent
    const question = prompted?.messages.at(-1)?.content as string
    expect(question).toContain(`<reader-prompt>\n${INSTRUCTION}\n</reader-prompt>`)
    expect(question).toMatch(/<\/reader-prompt>\n\nTheir question:\nWho is who so far$/)
    expect(question).not.toContain('Who’s who')
    expect(question).not.toContain('<request')
    expect(prompted?.system).toEqual(typed?.system)
    expect(prompted?.messages[0]).toEqual(typed?.messages[0])
    expect(JSON.stringify(prompted?.system)).not.toContain('reader-prompt')
  })

  it('runs a passage prompt on the quoted passage, and runs it as edited', async () => {
    const { user, cookie } = await reader()
    const id = await saved(user.id, 'Explain like I’m new', 'passage', 'Explain it simply.')
    const { sent, fetch } = capturing()
    const out = await events(await askWith(cookie, run(id, { quote: PASSAGE }), fetch))
    expect(String(out[0]?.text)).toContain('the passage you selected. Prompt: Explain it simply..')
    await raw`update ask_prompts set instruction = 'Explain it in one line.' where id = ${id}`
    await events(await askWith(cookie, run(id, { quote: PASSAGE }), fetch))
    const question = sent[1]?.messages.at(-1)?.content as string
    expect(question.indexOf('</passage>')).toBeLessThan(question.indexOf('<reader-prompt>'))
    expect(question).toContain('<reader-prompt>\nExplain it in one line.\n</reader-prompt>')
  })

  it('refuses a prompt that doesn’t fit the passage, or with an action or the highlights (400), before any call', async () => {
    const { user, cookie } = await reader()
    const pages = await saved(user.id, 'Pages', 'pages')
    const passage = await saved(user.id, 'Passage', 'passage')
    const { sent, fetch } = capturing()
    for (const payload of [
      run(passage),
      run(pages, { quote: PASSAGE }),
      run(pages, { action: 'summary' }),
      run(passage, { quote: PASSAGE, action: 'explain' }),
      run(pages, { highlights: true }),
      run('not-a-uuid'),
      run(pages, { prompt: null }),
    ]) {
      const response = await askWith(cookie, payload, fetch)
      expect([response.status, await response.json()], JSON.stringify(payload)).toEqual([400, { error: 'invalid' }])
    }
    expect(sent).toHaveLength(0)
  })

  it('is 404 no_prompt for a deleted prompt or another reader’s, before the limit, the key or any call', async () => {
    const { user, cookie } = await reader({ withKey: null })
    const other = await reader()
    const mine = await saved(user.id, 'Mine', 'pages')
    const theirs = await saved(other.user.id, 'Theirs', 'pages')
    await raw`delete from ask_prompts where id = ${mine}`
    const { sent, fetch } = capturing()
    for (const id of [mine, theirs]) {
      const response = await askWith(cookie, run(id), fetch)
      expect([response.status, await response.json()]).toEqual([404, { error: 'no_prompt' }])
    }
    expect(sent).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 50))
    expect(await raw`select 1 from audit_events where event = 'book.asked'`).toHaveLength(0)
  })

  it('is Pro: a Free reader is 403 before the prompt is looked at', async () => {
    const { user, cookie } = await reader()
    const id = await saved(user.id, 'Mine', 'pages')
    await raw`update users set pro_granted_at = null where id = ${user.id}`
    const { sent, fetch } = capturing()
    const response = await askWith(cookie, run(id), fetch)
    expect([response.status, await response.json()]).toEqual([403, { error: 'pro', feature: 'ask' }])
    expect(sent).toHaveLength(0)
  })

  it('audits the run as action prompt, without its name or text, and counts it toward the hourly limit', async () => {
    const { user, cookie } = await reader()
    const id = await saved(user.id, 'Secret name', 'pages', 'Secret instruction.')
    await events(await askWith(cookie, run(id), stubFetch))
    const [audit] = await askedEvents(user.id)
    expect(audit).toMatchObject({ action: 'prompt', stop: 'end_turn', highlights: 0 })
    const detail = JSON.stringify(audit)
    for (const secret of ['Secret', id, 'Who’s who']) expect(detail).not.toContain(secret)
    for (let i = 0; i < 59; i++) await recordEvent(db(), 'book.asked', { userId: user.id })
    const limited = await askWith(cookie, run(id), stubFetch)
    expect([limited.status, ((await limited.json()) as { error: string }).error]).toEqual([429, 'limit'])
  })
})

describe('Ask for a quiz or flashcards', () => {
  function capturing() {
    const sent: Record<string, unknown>[] = []
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST') sent.push(JSON.parse(await request.clone().text()))
      return anthropicStub(request)
    }) as typeof globalThis.fetch
    return { sent, fetch }
  }
  const askWith = (cookie: string, payload: unknown, fetch: typeof globalThis.fetch) =>
    handleAsk(
      new Request(`${origin}/read/pride-and-prejudice/ask`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', cookie },
        body: JSON.stringify(payload),
      }),
      'pride-and-prejudice',
      { fetch },
    )
  const QUIZ = { question: 'Quiz me on this chapter so far.', action: 'quiz' }
  const CARDS = { question: 'Make flashcards from this chapter so far.', action: 'flashcards' }

  it('answers a quiz event with five questions, then done, and audits it with its items', async () => {
    const { user, cookie } = await reader()
    const out = await events(await ask('pride-and-prejudice', cookie, body(QUIZ)))
    expect(out.map((e) => e.type)).toEqual(['quiz', 'done'])
    const quiz = out[0] as unknown as {
      span: string
      questions: {
        question: string
        choices: string[]
        answer: number
        why: string
        citations: unknown[]
        source: unknown
      }[]
    }
    expect(quiz.questions).toHaveLength(5)
    for (const q of quiz.questions) {
      expect(q.choices).toHaveLength(4)
      expect(q.choices[q.answer]).toBe(STUB_RIGHT_ANSWER)
      expect(q.citations).toEqual([
        { pageHref: '/read/pride-and-prejudice/chapter-3/2', label: 'Ch. 3 · p. 2', citedText: expect.any(String) },
      ])
      expect(q.source).toEqual({ position: { chapter: 'chapter-3', page: 2 }, label: 'Ch. 3 · p. 2' })
    }
    expect(quiz.questions[0]?.why).toMatch(/^The page says so \(1\)\.\u{e000}0\u{e001}$/u)
    const [audit] = await askedEvents(user.id)
    expect(audit).toMatchObject({ action: 'quiz', items: 5, stop: 'end_turn' })
  })

  it('answers flashcards with eight cards', async () => {
    const { user, cookie } = await reader()
    const out = await events(await ask('pride-and-prejudice', cookie, body(CARDS)))
    expect(out.map((e) => e.type)).toEqual(['cards', 'done'])
    const cards = (out[0] as unknown as { cards: { front: string }[] }).cards
    expect(cards.map((c) => c.front)).toEqual(
      Array.from({ length: 8 }, (_, i) => `Stub card ${i + 1}: what does the page say?`),
    )
    expect((await askedEvents(user.id))[0]).toMatchObject({ action: 'flashcards', items: 8 })
  })

  it('sends the same request as a typed question, apart from the last message', async () => {
    const { cookie } = await reader()
    const { sent, fetch } = capturing()
    await events(await askWith(cookie, body(QUIZ), fetch))
    await events(await askWith(cookie, body(), fetch))
    const [quiz, typed] = sent
    const last = (b: Record<string, unknown> | undefined) => ((b?.messages ?? []) as unknown[]).at(-1)
    const rest = (b: Record<string, unknown> | undefined) => ({
      ...b,
      messages: ((b?.messages ?? []) as unknown[]).slice(0, -1),
    })
    expect(rest(quiz)).toEqual(rest(typed))
    expect(String((last(quiz) as { content: string }).content)).toContain('<request kind="quiz">')
    expect(quiz).not.toHaveProperty('tools')
    expect(quiz).not.toHaveProperty('output_config.format')
  })

  it('refuses with too_little on a first chapter’s short page, before calling Anthropic or auditing (422)', async () => {
    const { user, cookie } = await reader()
    const start = await startImport(db(), user.id, {
      title: 'Short',
      author: 'Ada',
      language: 'en',
      details: NO_DETAILS,
      chapterCount: 1,
    })
    if (!start.ok) throw new Error('could not start')
    await storeChapter(db(), user.id, start.id, 0, {
      title: 'Only',
      pages: ['<p>A title page.</p>', `<p>${'Plenty of text. '.repeat(40)}</p>`],
    })
    expect(await finishImport(db(), user.id, start.id, null)).toBe('ok')
    const slug = privateBookSlug(start.id)
    const { sent, fetch } = capturing()
    const quizAt = (page: number) =>
      handleAsk(
        new Request(`${origin}/read/${slug}/ask`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json', cookie },
          body: JSON.stringify(body({ ...QUIZ, position: { chapter: 'only', page } })),
        }),
        slug,
        { fetch },
      )
    const response = await quizAt(1)
    expect([response.status, await response.json()]).toEqual([422, { error: 'too_little' }])
    expect(sent).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 50))
    expect(await raw`select 1 from audit_events where event = 'book.asked' and user_id = ${user.id}`).toHaveLength(0)
    expect((await events(await quizAt(2))).map((e) => e.type)).toEqual(['quiz', 'done'])
  })

  it('ends with bad_format when the answer is no quiz, and audits it', async () => {
    const { user, cookie } = await reader({ withKey: key(STUB_KEYS.badFormat) })
    const out = await events(await ask('pride-and-prejudice', cookie, body(QUIZ)))
    expect(out).toEqual([{ type: 'error', code: 'bad_format' }])
    expect((await askedEvents(user.id))[0]).toMatchObject({ action: 'quiz', items: null, error: 'bad_format' })
  })
})
