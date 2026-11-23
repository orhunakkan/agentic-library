import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { readAccount } from '~/server/account-data/store'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import type { RepoFile, RepoView, RepoViewState } from '~/shared/github-repos/contract'
import { MAX_REPOS } from '~/shared/github-repos/contract'
import { MOVING_FIRST, MOVING_SECOND, SAMPLE_COMMIT } from '../../../tests/e2e/support/github/fixture'
import { githubStubFetch, githubStubState, resetGitHubStub } from '../../../tests/e2e/support/github-stub'
import { REPO_ADD_LIMIT, REPO_REFRESH_LIMIT, REPO_VIEW_LIMIT } from '../rate-limit'
import { databaseUrl, freshDatabase } from '../testing/db'
import { testUser } from '../testing/users'
import {
  handleRepoAction,
  handleRepoAdd,
  handleRepoRaw,
  repoFolderState,
  reposState,
  repoViewState,
  STALE_MS,
  sniffPicture,
} from './actions'
import { resetRendered } from './files'
import { MAX_IN_FLIGHT, resetGitHub } from './github'
import { resetPacing, takeView } from './pacing'
import { addRepo, findRepo, listRepos, markOpened, removeRepo } from './store'
import { resetTrees } from './trees'
import { EMPTY_COMMIT } from './view'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()
const options = { fetch: githubStubFetch }

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, audit_events, github_repos restart identity cascade`
  resetGitHub()
  resetGitHubStub()
  resetTrees()
  resetRendered()
  resetPacing()
})
afterEach(() => vi.restoreAllMocks())

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const NOWHERE = '6f1c0000-0000-4000-8000-000000000000'

let users = 0
async function signedIn() {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member', {
    plan: users % 2 ? 'free' : 'pro',
  })
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
const get = (path: string, cookie: string | null) =>
  new Request(`${origin}${path}`, { headers: cookie ? { cookie } : {} })

const add = (cookie: string | null, url: unknown, headers: Record<string, string> = {}) =>
  handleRepoAdd(post('/account/repos/new', cookie, { url }, headers), options)
const act = (cookie: string | null, id: string, intent: unknown) =>
  handleRepoAction(post(`/account/repos/${id}`, cookie, { intent }), id, options)
const rawOf = (cookie: string | null, id: string, path: string) =>
  handleRepoRaw(get(`/account/repos/${id}/raw?path=${encodeURIComponent(path)}`, cookie), id, options)
const view = (cookie: string | null, id: string, path = '', mode: 'preview' | 'code' = 'preview') =>
  repoViewState(get(`/account/repos/${id}`, cookie), id, path, mode, options)
const file = async (cookie: string, id: string, path: string, mode: 'preview' | 'code' = 'preview') => {
  const state = await view(cookie, id, path, mode)
  if (state.state !== 'ready' || state.target.kind !== 'file') throw new Error(JSON.stringify(state))
  return state.target.file as RepoFile
}

const answer = async (response: Response) => [
  response.status,
  response.status === 403 ? null : (((await response.json()) as { error?: string }).error ?? null),
]

async function added(cookie: string, url = 'https://github.com/folio-test/sample') {
  const response = await add(cookie, url)
  expect(response.status).toBe(201)
  return (await response.json()) as { repo: RepoView; path: string }
}

const asked = () => githubStubState.requests.length

describe('the table', () => {
  it('checks the commit, the lengths and that ref and its kind come together', async () => {
    const { user } = await signedIn()
    const insert = (commit: string, ref: string | null, kind: string | null) =>
      raw`insert into github_repos (user_id, github_id, owner, name, default_branch, commit_sha, ref, ref_kind)
          values (${user.id}, 1, 'o', 'r', 'main', ${commit}, ${ref}, ${kind})`
    await expect(insert('x'.repeat(40), null, null)).rejects.toThrow(/check/)
    await expect(insert('a'.repeat(40), 'dev', null)).rejects.toThrow(/check/)
    await expect(insert('a'.repeat(40), 'dev', 'release')).rejects.toThrow(/check/)
    await insert('a'.repeat(40), null, null)
    await expect(insert('b'.repeat(40), null, null)).rejects.toThrow(/unique/)
    await insert('a'.repeat(40), 'dev', 'branch')
  })
})

describe('adding', () => {
  it('stores GitHub’s spelling, id, default branch and head commit, and answers the card', async () => {
    const { user, cookie } = await signedIn()
    const { repo, path } = await added(cookie, 'github.com/FOLIO-TEST/Sample.git')
    expect(path).toBe('')
    expect(repo).toMatchObject({
      owner: 'folio-test',
      name: 'sample',
      ref: null,
      refKind: 'default',
      defaultBranch: 'main',
      commit: SAMPLE_COMMIT,
      description: 'A fixture repository for Folio’s tests.',
      goneAt: null,
    })
    const [row] = await raw`select github_id, owner, name, commit_sha from github_repos where user_id = ${user.id}`
    expect(row).toEqual({ github_id: '1001', owner: 'folio-test', name: 'sample', commit_sha: SAMPLE_COMMIT })
  })

  it('resolves a two-segment branch and keeps the path after it', async () => {
    const { cookie } = await signedIn()
    const { repo, path } = await added(cookie, 'https://github.com/folio-test/sample/tree/feature/x/docs')
    expect(repo).toMatchObject({ ref: 'feature/x', refKind: 'branch', commit: SAMPLE_COMMIT })
    expect(path).toBe('docs')
  })

  it('names a tag, a commit and a short SHA by what they are', async () => {
    const { cookie } = await signedIn()
    const tag = await added(cookie, 'https://github.com/folio-test/sample/blob/v1.0/README.md')
    expect(tag.repo).toMatchObject({ ref: 'v1.0', refKind: 'tag' })
    expect(tag.path).toBe('README.md')
    const commit = await added(cookie, `https://github.com/folio-test/sample/tree/${SAMPLE_COMMIT}`)
    expect(commit.repo).toMatchObject({ refKind: 'commit', commit: SAMPLE_COMMIT })
    const short = await added(cookie, 'https://github.com/folio-test/sample/tree/1111111')
    expect(short.repo).toMatchObject({ ref: '1111111', refKind: 'commit' })
  })

  it('follows a rename to the repository’s new name', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/old-name')
    expect(repo).toMatchObject({ owner: 'folio-test', name: 'new-name', defaultBranch: 'trunk' })
  })

  it('keeps an empty repository, shown as empty', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/empty')
    expect(repo.commit).toBe(EMPTY_COMMIT)
    expect(await view(cookie, repo.id)).toMatchObject({ state: 'ready', target: { kind: 'empty' }, folders: [] })
    expect(await rawOf(cookie, repo.id, 'x.png').then((r) => r.status)).toBe(404)
    expect(await view(cookie, repo.id, 'README.md')).toMatchObject({ target: { kind: 'empty' } })
    expect(await repoFolderState(get('/', cookie), repo.id, '', options)).toEqual({ state: 'not_found' })
  })

  it.each([
    ['', 'empty'],
    ['x'.repeat(501), 'too_long'],
    ['not a url', 'not_url'],
    ['https://gitlab.com/a/b', 'not_github'],
    ['https://github.com/folio-test', 'not_repository'],
  ])('refuses %j as %s, before asking GitHub', async (url, reason) => {
    const { cookie } = await signedIn()
    const response = await add(cookie, url)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid', reason })
    expect(asked()).toBe(0)
  })

  it('answers a missing or private repository as not_found, and an unknown ref as ref_not_found', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await add(cookie, 'https://github.com/folio-test/nothing-here'))).toEqual([404, 'not_found'])
    expect(await answer(await add(cookie, 'https://github.com/folio-test/private-repo'))).toEqual([404, 'not_found'])
    expect(await answer(await add(cookie, 'https://github.com/folio-test/sample/tree/nope'))).toEqual([
      404,
      'ref_not_found',
    ])
    expect(await answer(await add(cookie, 'https://github.com/folio-test/empty/tree/main'))).toEqual([
      404,
      'ref_not_found',
    ])
    expect(await raw`select 1 from github_repos`).toHaveLength(0)
  })

  it('refuses the same repository at the same ref, with its id, and allows another ref', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    const again = await add(cookie, 'https://www.github.com/folio-test/sample/')
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'exists', id: repo.id })
    await added(cookie, 'https://github.com/folio-test/sample/tree/main')
  })

  it('keeps 25 repositories, and refuses the 26th', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into github_repos (user_id, github_id, owner, name, default_branch, commit_sha)
      select ${user.id}, g, 'o', 'r' || g, 'main', repeat('a', 40) from generate_series(1, ${MAX_REPOS}) g`
    const response = await add(cookie, 'https://github.com/folio-test/sample')
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'quota', max: 25 })
  })

  it('allows 30 adds an hour', async () => {
    const { user, cookie } = await signedIn()
    await raw`
      insert into audit_events (user_id, event, detail)
      select ${user.id}, 'repo.added', '{}'::jsonb from generate_series(1, ${REPO_ADD_LIMIT.max})`
    expect(await answer(await add(cookie, 'https://github.com/folio-test/sample'))).toEqual([429, 'limited'])
  })

  it('counts each add as a view, so failed adds have a limit too', async () => {
    const { user, cookie } = await signedIn()
    for (let i = 0; i < REPO_VIEW_LIMIT.max; i++) takeView(user.id)
    expect(await answer(await add(cookie, 'https://github.com/folio-test/nothing-here'))).toEqual([429, 'limited'])
    expect(asked()).toBe(0)
  })

  it('stops asking GitHub once its limit is used up, until the reset', async () => {
    const { cookie } = await signedIn()
    const limited = await add(cookie, 'https://github.com/folio-test/limited')
    expect(limited.status).toBe(503)
    const body = (await limited.json()) as { error: string; retryAt: string }
    expect(body.error).toBe('busy')
    expect(new Date(body.retryAt).getTime()).toBeGreaterThan(Date.now() + 30 * 60_000)
    const before = asked()
    const next = await add(cookie, 'https://github.com/folio-test/sample')
    expect(await next.json()).toEqual({ error: 'busy', retryAt: body.retryAt })
    expect(asked()).toBe(before)
  })

  it('answers busy without asking when too many requests are in flight', async () => {
    const { cookie } = await signedIn()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await gate
      return githubStubFetch(input, init)
    }) as typeof fetch
    const waiting = Array.from({ length: MAX_IN_FLIGHT }, () =>
      handleRepoAdd(post('/account/repos/new', cookie, { url: 'https://github.com/folio-test/sample' }), {
        fetch: slow,
      }),
    )
    await vi.waitFor(() => expect(githubStubState.requests.length).toBe(0))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await answer(await add(cookie, 'https://github.com/folio-test/moving'))).toEqual([503, 'busy'])
    release()
    await Promise.all(waiting)
  })

  it('answers GitHub being unreachable as unavailable', async () => {
    const { cookie } = await signedIn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const response = await handleRepoAdd(
      post('/account/repos/new', cookie, { url: 'https://github.com/folio-test/sample' }),
      { fetch: down },
    )
    expect(await answer(response)).toEqual([502, 'unavailable'])
  })

  it('refuses a missing session and bad bodies', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await add(null, 'https://github.com/folio-test/sample'))).toEqual([401, 'signed_out'])
    const send = (body: string) => handleRepoAdd(post('/account/repos/new', cookie, body), options)
    expect(await answer(await send('not json'))).toEqual([400, 'invalid'])
    expect(await answer(await send(JSON.stringify({ url: 3 })))).toEqual([400, 'invalid'])
  })
})

describe('refreshing', () => {
  function recording() {
    const sent: { url: string; headers: Headers }[] = []
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), headers: new Headers(init?.headers) })
      return githubStubFetch(input, init)
    }) as typeof globalThis.fetch
    return { sent, fetch }
  }

  it('asks conditionally and answers unchanged, then changed once GitHub moves', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/moving')
    expect(repo.commit).toBe(MOVING_FIRST)
    const { sent, fetch } = recording()
    const refresh = () =>
      handleRepoAction(post(`/account/repos/${repo.id}`, cookie, { intent: 'refresh' }), repo.id, { fetch })
    const same = await refresh()
    expect(await same.json()).toMatchObject({ changed: false, repo: { commit: MOVING_FIRST } })
    const commitsCall = sent.find((s) => s.url.includes('/commits/'))
    expect(commitsCall?.headers.get('if-none-match')).toBe(`"${MOVING_FIRST}"`)
    githubStubState.movingCommit = 1
    const moved = await refresh()
    expect(await moved.json()).toMatchObject({ changed: true, repo: { commit: MOVING_SECOND } })
    const events = await raw`select detail from audit_events where event = 'repo.refreshed' order by id`
    expect(events.map((e) => e.detail)).toEqual([
      { id: repo.id, changed: false },
      { id: repo.id, changed: true },
    ])
  })

  it('refreshes a branch by its head, as a branch', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/sample/tree/feature/x')
    const { sent, fetch } = recording()
    await handleRepoAction(post(`/account/repos/${repo.id}`, cookie, { intent: 'refresh' }), repo.id, { fetch })
    expect(sent.map((s) => new URL(s.url).pathname)).toEqual(['/repos/folio-test/sample/commits/heads/feature/x'])
  })

  it('updates the owner and name after a rename', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/new-name')
    await raw`update github_repos set name = 'old-name' where id = ${repo.id}`
    const refreshed = await act(cookie, repo.id, 'refresh')
    expect(await refreshed.json()).toMatchObject({ repo: { name: 'new-name' }, changed: false })
  })

  it('marks a repository gone on a 404, keeps it, and clears that when it is back', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/moving')
    githubStubState.movingGone = true
    const gone = (await (await act(cookie, repo.id, 'refresh')).json()) as { repo: RepoView; changed: boolean }
    expect(gone.changed).toBe(false)
    expect(gone.repo.goneAt).not.toBeNull()
    expect(await raw`select 1 from github_repos where id = ${repo.id} and gone_at is not null`).toHaveLength(1)
    resetTrees()
    expect(await view(cookie, repo.id)).toMatchObject({ state: 'ready', target: { kind: 'gone' } })
    githubStubState.movingGone = false
    const back = (await (await act(cookie, repo.id, 'refresh')).json()) as { repo: RepoView }
    expect(back.repo.goneAt).toBeNull()
  })

  it('marks a pinned branch gone when it is deleted', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/sample/tree/feature/x')
    await raw`update github_repos set ref = 'deleted-branch' where id = ${repo.id}`
    const gone = (await (await act(cookie, repo.id, 'refresh')).json()) as { repo: RepoView }
    expect(gone.repo.goneAt).not.toBeNull()
  })

  it('allows 120 refreshes an hour, and answers GitHub busy', async () => {
    const { user, cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/moving')
    const limited = await signedIn()
    const other = await added(limited.cookie, 'https://github.com/folio-test/moving')
    await raw`
      insert into audit_events (user_id, event, detail)
      select ${limited.user.id}, 'repo.refreshed', '{}'::jsonb from generate_series(1, ${REPO_REFRESH_LIMIT.max})`
    expect(await answer(await act(limited.cookie, other.repo.id, 'refresh'))).toEqual([429, 'limited'])
    expect(user.id).not.toBe(limited.user.id)
    await raw`update github_repos set github_id = 1006 where id = ${repo.id}`
    const busy = await act(cookie, repo.id, 'refresh')
    expect(busy.status).toBe(503)
  })

  it('refreshes on open when the last check is over an hour old, and not when it is fresh', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/moving')
    const fresh = await view(cookie, repo.id)
    expect(fresh).toMatchObject({ state: 'ready', refreshed: null })
    githubStubState.movingCommit = 1
    await raw`update github_repos set checked_at = now() - ${`${STALE_MS / 1000 + 60} seconds`}::interval where id = ${repo.id}`
    const stale = (await view(cookie, repo.id)) as Extract<RepoViewState, { state: 'ready' }>
    expect(stale.refreshed).toEqual({ changed: true })
    expect(stale.repo.commit).toBe(MOVING_SECOND)
    expect(stale.folders[0]?.entries.map((e) => e.name)).toEqual(['CHANGELOG.md', 'README.md'])
  })

  it('removes a repository, once', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    expect(await (await act(cookie, repo.id, 'remove')).json()).toEqual({ removed: true })
    expect(await answer(await act(cookie, repo.id, 'remove'))).toEqual([404, 'not_found'])
    expect(await answer(await act(cookie, repo.id, 'refresh'))).toEqual([404, 'not_found'])
  })

  it('refuses a bad id before any query, and an unknown intent', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    expect(await answer(await act(cookie, 'not-a-uuid', 'refresh'))).toEqual([404, 'not_found'])
    expect(await answer(await act(cookie, repo.id, 'delete'))).toEqual([400, 'invalid'])
    expect(await answer(await act(null, repo.id, 'refresh'))).toEqual([401, 'signed_out'])
  })
})

describe('reading', () => {
  it('lists the reader’s repositories, newest first', async () => {
    const { cookie } = await signedIn()
    const first = await added(cookie)
    const second = await added(cookie, 'https://github.com/folio-test/moving')
    const listed = await reposState(get('/account/repos', cookie))
    expect(listed.state === 'ready' && listed.repos.map((r) => r.id)).toEqual([second.repo.id, first.repo.id])
    expect(await reposState(get('/account/repos', null))).toEqual({ state: 'signed_out' })
  })

  it('opens the root with its entries and README, from one tree request', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    const before = asked()
    const state = (await view(cookie, repo.id)) as Extract<RepoViewState, { state: 'ready' }>
    expect(state.target.kind).toBe('folder')
    expect(state.folders.map((f) => f.path)).toEqual([''])
    expect(state.folders[0]?.entries.map((e) => [e.name, e.kind])).toEqual([
      ['assets', 'folder'],
      ['docs', 'folder'],
      ['examples', 'folder'],
      ['models', 'folder'],
      ['src', 'folder'],
      ['vendor', 'folder'],
      ['latest', 'link'],
      ['notes.txt', 'file'],
      ['README.md', 'file'],
    ])
    if (state.target.kind === 'folder') expect(state.target.folder.readme?.path).toBe('README.md')
    expect(githubStubState.requests.slice(before)).toEqual([
      `api/repos/folio-test/sample/git/trees/${SAMPLE_COMMIT}`,
      `raw/folio-test/sample/${SAMPLE_COMMIT}/README.md`,
    ])
    await view(cookie, repo.id)
    expect(asked()).toBe(before + 2)
  })

  it('opens a file with the folders down to it', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    const state = (await view(cookie, repo.id, 'docs/img/logo.png')) as Extract<RepoViewState, { state: 'ready' }>
    expect(state.folders.map((f) => f.path)).toEqual(['', 'docs', 'docs/img'])
    expect(state.target).toMatchObject({ kind: 'file', file: { content: { kind: 'picture' } } })
  })

  it('shows each kind of file', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    const id = repo.id
    expect((await file(cookie, id, 'README.md')).content).toMatchObject({ kind: 'markdown', view: 'preview' })
    expect((await file(cookie, id, 'README.md', 'code')).content).toMatchObject({ kind: 'markdown', view: 'code' })
    const code = await file(cookie, id, 'src/index.ts')
    expect(code).toMatchObject({ lines: 6, content: { kind: 'code', capped: false, code: { highlighted: true } } })
    expect((await file(cookie, id, 'src/data.bin')).content).toEqual({ kind: 'notice', notice: 'binary', size: 6 })
    expect((await file(cookie, id, 'models/weights.bin')).content).toEqual({ kind: 'notice', notice: 'lfs' })
    expect((await file(cookie, id, 'vendor/lib')).content).toEqual({ kind: 'notice', notice: 'submodule' })
    expect((await file(cookie, id, 'assets/huge.bin')).content).toEqual({
      kind: 'notice',
      notice: 'too-large',
      size: Math.round(2.4 * 1024 * 1024),
    })
    expect((await file(cookie, id, 'latest')).content).toEqual({
      kind: 'notice',
      notice: 'link',
      target: 'docs/guide.md',
      targetPath: 'docs/guide.md',
    })
  })

  it('opens a folder’s entries for the tree, and a path that isn’t there is missing', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    const folder = await repoFolderState(get('/', cookie), repo.id, 'docs', options)
    expect(folder.state === 'ready' && folder.entries.map((e) => e.path)).toEqual(['docs/img', 'docs/guide.md'])
    expect(await repoFolderState(get('/', cookie), repo.id, 'nope', options)).toEqual({ state: 'not_found' })
    expect(await repoFolderState(get('/', cookie), repo.id, 'README.md', options)).toEqual({ state: 'not_found' })
    expect(await view(cookie, repo.id, 'docs/gone.md')).toMatchObject({ state: 'ready', target: { kind: 'missing' } })
    expect(await view(cookie, repo.id, 'nope/deeper')).toMatchObject({ state: 'ready', target: { kind: 'missing' } })
  })

  it('refuses a .. path before asking GitHub anything', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    const before = asked()
    expect(await view(cookie, repo.id, '../../etc/passwd')).toEqual({ state: 'not_found' })
    expect(await repoFolderState(get('/', cookie), repo.id, 'docs/../..', options)).toEqual({ state: 'not_found' })
    expect(await view(cookie, repo.id, '..')).toEqual({ state: 'not_found' })
    expect((await rawOf(cookie, repo.id, '../x.png')).status).toBe(404)
    expect(asked()).toBe(before)
  })

  it('loads a truncated tree one folder at a time', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/huge')
    const state = (await view(cookie, repo.id, 'deep/a/b.md')) as Extract<RepoViewState, { state: 'ready' }>
    expect(state.folders.map((f) => f.path)).toEqual(['', 'deep', 'deep/a'])
    expect(state.target).toMatchObject({ kind: 'file', file: { path: 'deep/a/b.md' } })
    const folder = await repoFolderState(get('/', cookie), repo.id, 'deep', options)
    expect(folder.state === 'ready' && folder.entries.map((e) => e.name)).toEqual(['a', 'c.txt'])
  })

  it('answers busy when GitHub is, and limited past 600 views an hour', async () => {
    const { user, cookie } = await signedIn()
    const { repo } = await added(cookie)
    const busy = (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const state = await repoViewState(get('/', cookie), repo.id, '', 'preview', { fetch: busy })
    expect(state).toMatchObject({ state: 'busy' })
    resetGitHub()
    for (let i = 0; i < REPO_VIEW_LIMIT.max; i++) takeView(user.id)
    expect(await view(cookie, repo.id)).toEqual({ state: 'limited' })
    expect(await repoFolderState(get('/', cookie), repo.id, '', options)).toEqual({ state: 'limited' })
    expect((await rawOf(cookie, repo.id, 'docs/img/logo.png')).status).toBe(429)
  })

  it('answers signed_out and unavailable as the conventions’ reads do', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    expect(await view(null, repo.id)).toEqual({ state: 'signed_out' })
    expect(await view(cookie, 'not-a-uuid')).toEqual({ state: 'not_found' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (async () => {
      throw new Error('database down')
    }) as unknown as typeof fetch
    const failing = await repoViewState(get('/', cookie), repo.id, 'README.md', 'preview', { fetch: broken })
    expect(failing).toEqual({ state: 'unavailable' })
  })
})

describe('the raw endpoint', () => {
  it('serves a picture from the shown commit with the safe headers', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    const response = await rawOf(cookie, repo.id, 'docs/img/logo.png')
    expect(response.status).toBe(200)
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'cache-control': 'private, no-store',
    })
  })

  it('refuses what isn’t a picture, a picture over 5 MB, a link and a folder', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    for (const path of ['notes.txt', 'assets/poster.png', 'latest', 'docs', 'nope.png', ''])
      expect((await rawOf(cookie, repo.id, path)).status, path).toBe(404)
  })

  it('sniffs every picture type it serves', () => {
    const bytes = (...values: (number | string)[]) =>
      new Uint8Array(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])))
    expect(sniffPicture(bytes(0, 0, 0, 0, 'ftyp', 'avif'))).toBe('image/avif')
    expect(sniffPicture(new Uint8Array([66, 77, ...new Array(30).fill(0)]))).toBe('image/bmp')
    expect(sniffPicture(new Uint8Array([0, 0, 1, 0, ...new Array(30).fill(0)]))).toBe('image/x-icon')
    expect(sniffPicture(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'image/svg+xml',
    )
    expect(sniffPicture(new TextEncoder().encode('hello'))).toBeNull()
  })
})

describe('another reader', () => {
  it('gets a 404 for someone else’s repository on every read, action and the raw endpoint', async () => {
    const owner = await signedIn()
    const { repo } = await added(owner.cookie)
    const other = await signedIn()
    expect(await view(other.cookie, repo.id)).toEqual({ state: 'not_found' })
    expect(await repoFolderState(get('/', other.cookie), repo.id, '', options)).toEqual({ state: 'not_found' })
    expect(await answer(await act(other.cookie, repo.id, 'refresh'))).toEqual([404, 'not_found'])
    expect(await answer(await act(other.cookie, repo.id, 'remove'))).toEqual([404, 'not_found'])
    expect((await rawOf(other.cookie, repo.id, 'docs/img/logo.png')).status).toBe(404)
    expect((await rawOf(null, repo.id, 'docs/img/logo.png')).status).toBe(404)
    expect(await raw`select 1 from github_repos where id = ${repo.id}`).toHaveLength(1)
  })
})

describe('the store', () => {
  it('scopes every query by user, and notes an open at most once a minute', async () => {
    const { user } = await signedIn()
    const other = await signedIn()
    const row = await addRepo(db(), user.id, {
      githubId: 1,
      owner: 'o',
      name: 'r',
      ref: null,
      refKind: null,
      defaultBranch: 'main',
      description: null,
      commitSha: 'a'.repeat(40),
    })
    if (typeof row === 'string' || 'exists' in row) throw new Error('not added')
    expect(await findRepo(db(), other.user.id, row.id)).toBeNull()
    expect(await findRepo(db(), user.id, 'nope')).toBeNull()
    expect(await listRepos(db(), other.user.id)).toEqual([])
    expect(await removeRepo(db(), other.user.id, row.id)).toBe(false)
    expect(await removeRepo(db(), user.id, 'nope')).toBe(false)
    await markOpened(db(), user.id, row.id)
    const [first] = await raw`select opened_at from github_repos where id = ${row.id}`
    await markOpened(db(), user.id, row.id)
    const [second] = await raw`select opened_at from github_repos where id = ${row.id}`
    expect(second?.opened_at).toEqual(first?.opened_at)
  })
})

describe('bookkeeping', () => {
  it('audits ids only, and logs no owner, name or path', async () => {
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')))
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void lines.push(args.join(' ')))
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/moving')
    await act(cookie, repo.id, 'refresh')
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    resetTrees()
    await repoViewState(get('/', cookie), repo.id, 'README.md', 'preview', { fetch: down })
    await handleRepoAdd(post('/account/repos/new', cookie, { url: 'https://github.com/folio-test/sample' }), {
      fetch: down,
    })
    await act(cookie, repo.id, 'remove')
    const events = await raw`select event, detail from audit_events order by id`
    expect(events.map((e) => [e.event, Object.keys(e.detail as object).sort()])).toEqual([
      ['repo.added', ['id']],
      ['repo.refreshed', ['changed', 'id']],
      ['repo.removed', ['id']],
    ])
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).not.toMatch(/folio-test|moving|sample|README/)
  })

  it('the data download lists the repositories, without files', async () => {
    const { user, cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/sample/tree/feature/x')
    await view(cookie, repo.id)
    const rows = await readAccount(db(), user.id)
    expect(rows?.githubRepos).toEqual([
      {
        owner: 'folio-test',
        name: 'sample',
        ref: 'feature/x',
        addedAt: expect.any(Date),
        openedAt: expect.any(Date),
        goneAt: null,
      },
    ])
  })

  it('deleting the account deletes its repositories', async () => {
    const { user, cookie } = await signedIn()
    await added(cookie)
    await raw`delete from users where id = ${user.id}`
    expect(await raw`select 1 from github_repos`).toHaveLength(0)
  })
})

describe('the account’s own refusals', () => {
  it('a missing database is signed out', async () => {
    expect(await reposState(get('/', null))).toEqual({ state: 'signed_out' })
    expect((await rawOf(null, NOWHERE, 'x.png')).status).toBe(404)
  })
})

describe('GitHub failing part of the way', () => {
  const failing = (pattern: RegExp, status = 500) =>
    (async (input: RequestInfo | URL, init?: RequestInit) =>
      pattern.test(new URL(String(input)).pathname)
        ? new Response('down', { status })
        : githubStubFetch(input, init)) as typeof fetch

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('a ref longer than GitHub allows is no ref, and GitHub failing on a ref is unavailable', async () => {
    const { cookie } = await signedIn()
    expect(await answer(await add(cookie, `https://github.com/folio-test/sample/tree/${'x'.repeat(256)}`))).toEqual([
      404,
      'ref_not_found',
    ])
    const down = { fetch: failing(/\/commits\//) }
    const response = await handleRepoAdd(
      post('/account/repos/new', cookie, { url: 'https://github.com/folio-test/sample/tree/main' }),
      down,
    )
    expect(await answer(response)).toEqual([502, 'unavailable'])
    const plain = await handleRepoAdd(
      post('/account/repos/new', cookie, { url: 'https://github.com/folio-test/sample' }),
      down,
    )
    expect(await answer(plain)).toEqual([502, 'unavailable'])
    const noHead = await handleRepoAdd(
      post('/account/repos/new', cookie, { url: 'https://github.com/folio-test/sample' }),
      {
        fetch: failing(/\/commits\//, 422),
      },
    )
    expect(await answer(noHead)).toEqual([404, 'ref_not_found'])
  })

  it('the raw endpoint answers 503 when GitHub fails, for the tree or the file', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    const tree = await handleRepoRaw(get(`/x?path=docs%2Fimg%2Flogo.png`, cookie), repo.id, {
      fetch: failing(/\/git\/trees\//),
    })
    expect(tree.status).toBe(503)
    const file = await handleRepoRaw(get(`/x?path=docs%2Fimg%2Flogo.png`, cookie), repo.id, {
      fetch: failing(/logo\.png$/),
    })
    expect(file.status).toBe(503)
    resetTrees()
    const gone = await handleRepoRaw(get(`/x?path=docs%2Fimg%2Flogo.png`, cookie), repo.id, {
      fetch: failing(/\/git\/trees\//, 404),
    })
    expect(gone.status).toBe(404)
  })

  it('a folder read answers GitHub’s failure, and a file read the file’s', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    expect(await repoFolderState(get('/', cookie), repo.id, '', { fetch: failing(/\/git\/trees\//) })).toEqual({
      state: 'unavailable',
    })
    expect(await repoFolderState(get('/', cookie), repo.id, '', { fetch: failing(/\/git\/trees\//, 404) })).toEqual({
      state: 'not_found',
    })
    expect(await repoFolderState(get('/', cookie), repo.id, '../x', options)).toEqual({ state: 'not_found' })
    const file = await repoViewState(get('/', cookie), repo.id, 'src/index.ts', 'preview', {
      fetch: failing(/index\.ts$/),
    })
    expect(file).toEqual({ state: 'unavailable' })
    const readme = await repoViewState(get('/', cookie), repo.id, '', 'preview', { fetch: failing(/README\.md$/) })
    expect(readme).toEqual({ state: 'unavailable' })
    const gone = await repoViewState(get('/', cookie), repo.id, 'src/index.ts', 'preview', {
      fetch: failing(/index\.ts$/, 404),
    })
    expect(gone).toMatchObject({ state: 'ready', target: { kind: 'missing' } })
  })

  it('a truncated tree’s folder that GitHub fails on is unavailable', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/huge')
    await view(cookie, repo.id)
    const deep = await repoFolderState(get('/', cookie), repo.id, 'deep', {
      fetch: failing(/\/git\/trees\/(?!8{40})/),
    })
    expect(deep).toEqual({ state: 'unavailable' })
    const viewed = await repoViewState(get('/', cookie), repo.id, 'deep/a/b.md', 'preview', {
      fetch: failing(/\/git\/trees\/(?!8{40})/),
    })
    expect(viewed).toEqual({ state: 'unavailable' })
    resetTrees()
    const root = await repoViewState(get('/', cookie), repo.id, '', 'preview', {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
        new URL(String(input)).search === '' && /\/git\/trees\//.test(String(input))
          ? new Response('down', { status: 500 })
          : githubStubFetch(input, init)) as typeof fetch,
    })
    expect(root).toEqual({ state: 'unavailable' })
  })

  it('refreshes a tag as it is, and an empty repository stays empty', async () => {
    const { cookie } = await signedIn()
    const tag = await added(cookie, 'https://github.com/folio-test/sample/tree/v1.0')
    expect(await (await act(cookie, tag.repo.id, 'refresh')).json()).toMatchObject({ changed: false })
    const empty = await added(cookie, 'https://github.com/folio-test/empty')
    expect(await (await act(cookie, empty.repo.id, 'refresh')).json()).toMatchObject({
      changed: false,
      repo: { commit: EMPTY_COMMIT, goneAt: null },
    })
    await raw`update github_repos set ref = 'main', ref_kind = 'branch' where id = ${empty.repo.id}`
    const pinned = (await (await act(cookie, empty.repo.id, 'refresh')).json()) as { repo: RepoView }
    expect(pinned.repo.goneAt).not.toBeNull()
  })

  it('opens a stale repository at its last commit when the refresh can’t happen', async () => {
    const { user, cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/moving')
    await raw`update github_repos set checked_at = now() - interval '2 hours' where id = ${repo.id}`
    await raw`
      insert into audit_events (user_id, event, detail)
      select ${user.id}, 'repo.refreshed', '{}'::jsonb from generate_series(1, ${REPO_REFRESH_LIMIT.max})`
    expect(await view(cookie, repo.id)).toMatchObject({
      state: 'ready',
      refreshed: null,
      repo: { commit: MOVING_FIRST },
    })
  })
})

describe('the database failing', () => {
  it('answers 500 failed, unavailable or 503, and logs without the address', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    const real = getDb()
    const breakNext = () => vi.mocked(getDb).mockReturnValueOnce(real).mockReturnValueOnce(broken)
    breakNext()
    expect(await answer(await add(cookie, 'https://github.com/folio-test/secret-name'))).toEqual([500, 'failed'])
    breakNext()
    expect(await answer(await act(cookie, repo.id, 'remove'))).toEqual([500, 'failed'])
    breakNext()
    expect((await rawOf(cookie, repo.id, 'docs/img/logo.png')).status).toBe(503)
    breakNext()
    expect(await reposState(get('/', cookie))).toEqual({ state: 'unavailable' })
    breakNext()
    expect(await view(cookie, repo.id)).toEqual({ state: 'unavailable' })
    breakNext()
    expect(await repoFolderState(get('/', cookie), repo.id, '', options)).toEqual({ state: 'unavailable' })
    const lines = errors.mock.calls.map((call) => String(call[0]))
    expect(lines).toEqual([
      expect.stringMatching(/^\[repo add\] /),
      expect.stringMatching(/^\[repo action\] /),
      expect.stringMatching(/^\[repo raw\] /),
      expect.stringMatching(/^\[repos\] /),
      expect.stringMatching(/^\[repo view\] /),
      expect.stringMatching(/^\[repo folder\] /),
    ])
    expect(lines.join('\n')).not.toMatch(/secret-name|folio-test/)
  })
})

describe('the caches', () => {
  it('forget the least recently read tree past their size, and ask GitHub again for it', async () => {
    const { cookie } = await signedIn()
    const sample = await added(cookie)
    const moving = await added(cookie, 'https://github.com/folio-test/moving')
    resetTrees(3000)
    await view(cookie, sample.repo.id)
    await view(cookie, moving.repo.id)
    const before = asked()
    await view(cookie, sample.repo.id)
    expect(githubStubState.requests.slice(before)).toContain(`api/repos/folio-test/sample/git/trees/${SAMPLE_COMMIT}`)
    resetTrees()
  })

  it('load a truncated tree’s folder on its own the first time the tree opens it', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/huge')
    const folder = await repoFolderState(get('/', cookie), repo.id, 'deep/a', options)
    expect(folder.state === 'ready' && folder.entries.map((e) => e.name)).toEqual(['b.md'])
  })

  it('a refresh of a pinned ref that GitHub fails on is unavailable', async () => {
    const { cookie } = await signedIn()
    const { repo } = await added(cookie, 'https://github.com/folio-test/sample/tree/v1.0')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/commits/')
        ? new Response('down', { status: 500 })
        : githubStubFetch(input, init)) as typeof fetch
    const response = await handleRepoAction(post(`/account/repos/${repo.id}`, cookie, { intent: 'refresh' }), repo.id, {
      fetch: down,
    })
    expect(await answer(response)).toEqual([502, 'unavailable'])
  })
})
