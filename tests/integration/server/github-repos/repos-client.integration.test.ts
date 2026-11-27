import { afterAll, beforeEach, describe, expect, vi } from 'vitest'
import { it, raw } from '../../../support/server/db-test'
import { testUser } from '../../../support/server/users'

vi.mock('~/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/db')>()
  return { ...actual, getDb: vi.fn(actual.getDb) }
})

import { addRepo, refreshRepo, removeRepo } from '~/client/features/github-repos/repos-client'
import { getConfig } from '~/server/config'
import { closeDb, getDb, type Pool } from '~/server/db'
import { handleRepoAction, handleRepoAdd, reposState } from '~/server/github-repos/actions'
import { resetRendered } from '~/server/github-repos/files'
import { resetGitHub } from '~/server/github-repos/github'
import { resetPacing } from '~/server/github-repos/pacing'
import { resetTrees } from '~/server/github-repos/trees'
import { EMPTY_COMMIT } from '~/server/github-repos/view'
import { REPO_ADD_LIMIT, REPO_REFRESH_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import { MAX_REPOS } from '~/shared/github-repos/contract'
import { MOVING_FIRST, MOVING_SECOND, SAMPLE_COMMIT } from '../../../stubs/github/fixture'
import { githubStubFetch, githubStubState, resetGitHubStub } from '../../../stubs/github-stub'
import { spend } from '../../../support/server/quota'

const db = () => getDb()
const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const NOWHERE = '6f1c0000-0000-4000-8000-000000000000'
const SAMPLE = 'https://github.com/folio-test/sample'
const MOVING = 'https://github.com/folio-test/moving'

afterAll(async () => {
  await closeDb()
})
beforeEach(() => {
  resetGitHub()
  resetGitHubStub()
  resetTrees()
  resetRendered()
  resetPacing()
})

let users = 0

/**
 * Signs a reader in, and routes the client's fetch to the real repository handlers with their cookie. The handlers ask
 * `github`, the GitHub stub unless a test says otherwise.
 */
async function signedIn(signedOut = false) {
  const user = await testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  const cookie = `${cookieName}=${token}`
  const github = { fetch: githubStubFetch }
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    headers.set('origin', origin)
    if (!signedOut) headers.set('cookie', cookie)
    const request = new Request(`${origin}${path}`, { ...init, headers })
    if (path === '/account/repos/new') return handleRepoAdd(request, github)
    const [, id] = /^\/account\/repos\/([^/]+)$/.exec(path) ?? []
    if (!id) throw new Error(`no repos route at ${path}`)
    return handleRepoAction(request, decodeURIComponent(id), github)
  })
  const state = () => reposState(new Request(`${origin}/account/repos`, { headers: { cookie } }))
  return { user, github, state }
}

async function added(url: string) {
  const result = await addRepo(url)
  if (!result.ok) throw new Error(result.problem)
  return result.value.repo
}

describe('the repos client against the repository endpoints', () => {
  it('adds, refreshes and removes a repository, reading back what the server stored', async () => {
    const { state } = await signedIn()
    const made = await addRepo(`${SAMPLE}/tree/feature/x/docs`)
    if (!made.ok) throw new Error(made.problem)
    expect(made.value).toEqual({
      path: 'docs',
      repo: {
        id: expect.any(String),
        owner: 'folio-test',
        name: 'sample',
        description: 'A fixture repository for Folio’s tests.',
        ref: 'feature/x',
        refKind: 'branch',
        defaultBranch: 'main',
        commit: SAMPLE_COMMIT,
        addedAt: expect.any(String),
        checkedAt: expect.any(String),
        goneAt: null,
      },
    })
    expect(await state()).toEqual({ state: 'ready', repos: [made.value.repo] })

    const moving = await added(MOVING)
    expect(moving.commit).toBe(MOVING_FIRST)
    expect(await refreshRepo(moving.id)).toEqual({
      ok: true,
      value: { changed: false, repo: { ...moving, checkedAt: expect.any(String) } },
    })
    githubStubState.movingCommit = 1
    expect(await refreshRepo(moving.id)).toMatchObject({
      ok: true,
      value: { changed: true, repo: { id: moving.id, commit: MOVING_SECOND } },
    })

    expect(await removeRepo(moving.id)).toEqual({ ok: true, value: true })
    expect(await removeRepo(made.value.repo.id)).toEqual({ ok: true, value: true })
    expect(await state()).toEqual({ state: 'ready', repos: [] })
  })

  it('reads an empty repository as added, with no commit', async () => {
    await signedIn()
    expect((await added('https://github.com/folio-test/empty')).commit).toBe(EMPTY_COMMIT)
  })

  it.each([
    ['empty', ''],
    ['too_long', 'x'.repeat(501)],
    ['not_url', 'not a url'],
    ['not_github', 'https://gitlab.com/a/b'],
    ['not_repository', 'https://github.com/folio-test'],
  ])('reads an address refused as invalid for %s as that problem', async (reason, url) => {
    await signedIn()
    expect(await addRepo(url)).toEqual({ ok: false, problem: reason, failure: { problem: reason } })
  })

  it('reads each refusal the server sends as its problem', async () => {
    await signedIn()
    const repo = await added(SAMPLE)
    expect(await addRepo(`${SAMPLE}/`)).toEqual({
      ok: false,
      problem: 'exists',
      failure: { problem: 'exists', existingId: repo.id },
    })
    expect(await addRepo('https://github.com/folio-test/nothing-here')).toMatchObject({
      ok: false,
      problem: 'not_found',
    })
    expect(await addRepo(`${SAMPLE}/tree/nope`)).toMatchObject({ ok: false, problem: 'ref_not_found' })
    expect(await refreshRepo(NOWHERE)).toMatchObject({ ok: false, problem: 'not_found' })
    expect(await refreshRepo('not-a-uuid')).toMatchObject({ ok: false, problem: 'not_found' })
    expect(await removeRepo(NOWHERE)).toMatchObject({ ok: false, problem: 'not_found' })
    expect(await raw`select 1 from github_repos`).toHaveLength(1)
  })

  it('reads the repository limit as quota', async () => {
    const { user } = await signedIn()
    await raw`
      insert into github_repos (user_id, github_id, owner, name, default_branch, commit_sha)
      select ${user.id}, g, 'o', 'r' || g, 'main', repeat('a', 40) from generate_series(1, ${MAX_REPOS}) g`
    expect(await addRepo(SAMPLE)).toEqual({ ok: false, problem: 'quota', failure: { problem: 'quota' } })
  })

  it('reads the hourly add and refresh limits as limited', async () => {
    const { user } = await signedIn()
    const repo = await added(MOVING)
    /** The add above took one of the hour's adds. */
    await spend(db(), user.id, 'repo-add', REPO_ADD_LIMIT.max - 1)
    expect(await addRepo(SAMPLE)).toEqual({ ok: false, problem: 'limited', failure: { problem: 'limited' } })
    await spend(db(), user.id, 'repo-refresh', REPO_REFRESH_LIMIT.max)
    expect(await refreshRepo(repo.id)).toEqual({ ok: false, problem: 'limited', failure: { problem: 'limited' } })
  })

  it('reads GitHub’s limit running out as busy, with when to try again', async () => {
    await signedIn()
    const busy = await addRepo('https://github.com/folio-test/limited')
    expect(busy).toEqual({ ok: false, problem: 'busy', failure: { problem: 'busy', retryAt: expect.any(String) } })
    const retryAt = busy.ok ? null : busy.failure?.retryAt
    expect(new Date(retryAt ?? 0).getTime()).toBeGreaterThan(Date.now() + 30 * 60_000)
  })

  it('reads GitHub being unreachable as unavailable', async () => {
    const { github } = await signedIn()
    const repo = await added(MOVING)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    github.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await addRepo(SAMPLE)).toMatchObject({ ok: false, problem: 'unavailable' })
    expect(await refreshRepo(repo.id)).toMatchObject({ ok: false, problem: 'unavailable' })
  })

  it('reads a signed-out answer as signed out', async () => {
    await signedIn(true)
    expect(await addRepo(SAMPLE)).toMatchObject({ ok: false, problem: 'signed_out' })
    expect(await removeRepo(NOWHERE)).toMatchObject({ ok: false, problem: 'signed_out' })
  })

  it('reads the server failing as failed', async () => {
    await signedIn()
    const repo = await added(SAMPLE)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (() => {
      throw new Error('the database went away')
    }) as unknown as Pool
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    expect(await addRepo(MOVING)).toEqual({ ok: false, problem: 'failed', failure: { problem: 'failed' } })
    vi.mocked(getDb).mockReturnValueOnce(getDb()).mockReturnValueOnce(broken)
    expect(await removeRepo(repo.id)).toEqual({ ok: false, problem: 'failed', failure: { problem: 'failed' } })
  })
})
