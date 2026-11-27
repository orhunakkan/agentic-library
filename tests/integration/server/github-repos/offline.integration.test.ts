import { afterAll, beforeEach, describe, expect, vi } from 'vitest'
import { getConfig } from '~/server/config'
import { closeDb, getDb } from '~/server/db'
import { handleRepoAdd } from '~/server/github-repos/actions'
import { resetRendered } from '~/server/github-repos/files'
import { resetGitHub } from '~/server/github-repos/github'
import { handleRepoOfflineBatch, handleRepoOfflinePlan } from '~/server/github-repos/offline'
import { resetPacing, takeView } from '~/server/github-repos/pacing'
import { resetTrees } from '~/server/github-repos/trees'
import { REPO_VIEW_LIMIT } from '~/server/rate-limit'
import { hashToken, newSessionToken } from '~/server/security'
import { createSession } from '~/server/sessions'
import type { RepoView } from '~/shared/github-repos/contract'
import {
  MAX_OFFLINE_BYTES,
  MAX_OFFLINE_FILES,
  OFFLINE_BATCH_MAX,
  type RepoOfflineBatch,
  type RepoOfflinePlan,
} from '~/shared/github-repos/offline'
import { MOVING_FIRST, SAMPLE_COMMIT } from '../../../stubs/github/fixture'
import { githubStubFetch, githubStubState, resetGitHubStub } from '../../../stubs/github-stub'
import { it } from '../../../support/server/db-test'
import { testUser } from '../../../support/server/users'

const db = () => getDb()
const options = { fetch: githubStubFetch }

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

const origin = getConfig().appOrigin
const cookieName = getConfig().cookieSecure ? '__Host-session' : 'session'
const NOWHERE = '6f1c0000-0000-4000-8000-000000000000'

let users = 0
async function signedIn() {
  const user = await testUser(db(), `offline-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')
  const token = newSessionToken()
  await createSession(db(), { tokenHash: hashToken(token), userId: user.id, ip: null, userAgent: 'test' })
  return { user, cookie: `${cookieName}=${token}` }
}

const headers = (cookie: string | null) => ({
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
  ...(cookie ? { cookie } : {}),
})

async function added(cookie: string, url = 'https://github.com/folio-test/sample'): Promise<RepoView> {
  const request = new Request(`${origin}/account/repos/new`, {
    method: 'POST',
    headers: { ...headers(cookie), origin },
    body: JSON.stringify({ url }),
  })
  const response = await handleRepoAdd(request, options)
  expect(response.status).toBe(201)
  return ((await response.json()) as { repo: RepoView }).repo
}

const planOf = (cookie: string | null, id: string, fetcher = options) =>
  handleRepoOfflinePlan(new Request(`${origin}/account/repos/${id}/offline`, { headers: headers(cookie) }), id, fetcher)

const batchOf = (cookie: string | null, id: string, body: unknown, fetcher = options) =>
  handleRepoOfflineBatch(
    new Request(`${origin}/account/repos/${id}/offline`, {
      method: 'POST',
      headers: headers(cookie),
      body: JSON.stringify(body),
    }),
    id,
    fetcher,
  )

const answer = async (response: Response) => [response.status, ((await response.json()) as { error?: string }).error]

describe('the plan', () => {
  it('lists every folder with its README, every file, and the bytes to fetch, at the pinned commit', async () => {
    const { cookie } = await signedIn()
    const repo = await added(cookie)
    const response = await planOf(cookie, repo.id)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const plan = (await response.json()) as RepoOfflinePlan
    expect(plan.repo).toMatchObject({ id: repo.id, commit: SAMPLE_COMMIT })
    expect(plan.folders.map((f) => [f.path, f.readme])).toEqual([
      ['', 'README.md'],
      ['assets', null],
      ['docs', null],
      ['docs/img', null],
      ['examples', null],
      ['models', null],
      ['src', null],
      ['vendor', null],
    ])
    expect(plan.files).toHaveLength(12)
    expect(plan.files.slice(0, 3)).toEqual(['latest', 'notes.txt', 'README.md'])
    expect(plan.bytes).toBeGreaterThan(0)
    expect(plan.bytes).toBeLessThan(5000)
  })

  it('answers too_large with the numbers past the caps, and with none for a tree GitHub truncates', async () => {
    const { cookie } = await signedIn()
    const bulky = await added(cookie, 'https://github.com/folio-test/bulky')
    const response = await planOf(cookie, bulky.id)
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: 'too_large',
      files: 21,
      bytes: 20 * 1024 * 1024 + '# Bulky\n'.length,
      maxFiles: MAX_OFFLINE_FILES,
      maxBytes: MAX_OFFLINE_BYTES,
    })
    const huge = await added(cookie, 'https://github.com/folio-test/huge')
    const truncated = await planOf(cookie, huge.id)
    expect(truncated.status).toBe(413)
    expect(await truncated.json()).toEqual({
      error: 'too_large',
      files: null,
      bytes: null,
      maxFiles: MAX_OFFLINE_FILES,
      maxBytes: MAX_OFFLINE_BYTES,
    })
  })

  it('answers not_found for an empty repository, one GitHub no longer has, and one that isn’t a repository id', async () => {
    const { cookie } = await signedIn()
    const empty = await added(cookie, 'https://github.com/folio-test/empty')
    expect(await answer(await planOf(cookie, empty.id))).toEqual([404, 'not_found'])
    const moving = await added(cookie, 'https://github.com/folio-test/moving')
    expect(moving.commit).toBe(MOVING_FIRST)
    githubStubState.movingGone = true
    expect(await answer(await planOf(cookie, moving.id))).toEqual([404, 'not_found'])
    expect(await answer(await planOf(cookie, 'not-an-id'))).toEqual([404, 'not_found'])
  })
})

describe('a batch', () => {
  it('renders each path as the preview page does, and the plan’s batches cover the copy', async () => {
    const { cookie } = await signedIn()
    const repo = await added(cookie)
    const plan = (await (await planOf(cookie, repo.id)).json()) as RepoOfflinePlan
    const files = []
    for (let i = 0; i < plan.files.length; i += 5) {
      const response = await batchOf(cookie, repo.id, { commit: plan.repo.commit, paths: plan.files.slice(i, i + 5) })
      expect(response.status).toBe(200)
      files.push(...((await response.json()) as RepoOfflineBatch).files)
    }
    expect(files.map((f) => f.path)).toEqual(plan.files)
    const byPath = new Map(files.map((f) => [f.path, f]))
    expect(byPath.get('README.md')?.content).toMatchObject({ kind: 'markdown', view: 'preview' })
    expect(byPath.get('src/index.ts')?.content).toMatchObject({ kind: 'code', capped: false })
    expect(byPath.get('docs/img/logo.png')?.content).toEqual({ kind: 'picture' })
    expect(byPath.get('vendor/lib')?.content).toEqual({ kind: 'notice', notice: 'submodule' })
    expect(byPath.get('latest')?.content).toMatchObject({ kind: 'notice', notice: 'link', targetPath: 'docs/guide.md' })
  })

  it('answers changed for another commit, and invalid for a folder, a path not in the tree, or too many paths', async () => {
    const { cookie } = await signedIn()
    const repo = await added(cookie)
    const commit = SAMPLE_COMMIT
    expect(await answer(await batchOf(cookie, repo.id, { commit: 'f'.repeat(40), paths: ['README.md'] }))).toEqual([
      409,
      'changed',
    ])
    expect(await answer(await batchOf(cookie, repo.id, { commit, paths: ['docs'] }))).toEqual([400, 'invalid'])
    expect(await answer(await batchOf(cookie, repo.id, { commit, paths: ['nowhere.md'] }))).toEqual([400, 'invalid'])
    expect(await answer(await batchOf(cookie, repo.id, { commit, paths: [] }))).toEqual([400, 'invalid'])
    const many = Array.from({ length: OFFLINE_BATCH_MAX + 1 }, (_, i) => `f${i}`)
    expect(await answer(await batchOf(cookie, repo.id, { commit, paths: many }))).toEqual([400, 'invalid'])
    expect(await answer(await batchOf(cookie, repo.id, { commit, paths: ['README.md'], extra: 1 }))).toEqual([
      400,
      'invalid',
    ])
  })
})

describe('both endpoints', () => {
  it('answer signed_out without a session, and not_found for someone else’s repository', async () => {
    const owner = await signedIn()
    const repo = await added(owner.cookie)
    const body = { commit: SAMPLE_COMMIT, paths: ['README.md'] }
    expect(await answer(await planOf(null, repo.id))).toEqual([401, 'signed_out'])
    expect(await answer(await batchOf(null, repo.id, body))).toEqual([401, 'signed_out'])
    const other = await signedIn()
    expect(await answer(await planOf(other.cookie, repo.id))).toEqual([404, 'not_found'])
    expect(await answer(await batchOf(other.cookie, repo.id, body))).toEqual([404, 'not_found'])
    expect(await answer(await planOf(other.cookie, NOWHERE))).toEqual([404, 'not_found'])
  })

  it('refuse a request from another site', async () => {
    const { cookie } = await signedIn()
    const repo = await added(cookie)
    const request = new Request(`${origin}/account/repos/${repo.id}/offline`, {
      headers: { cookie, 'sec-fetch-site': 'cross-site' },
    })
    expect((await handleRepoOfflinePlan(request, repo.id, options)).status).toBe(403)
  })

  it('answer busy with GitHub’s retry time', async () => {
    const { cookie } = await signedIn()
    const repo = await added(cookie)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const busy = { fetch: (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch }
    const response = await planOf(cookie, repo.id, busy)
    expect(response.status).toBe(503)
    const refusal = (await response.json()) as { error: string; retryAt: string | null }
    expect(refusal.error).toBe('busy')
    expect(refusal.retryAt).toEqual(expect.any(String))
    const batch = await batchOf(cookie, repo.id, { commit: SAMPLE_COMMIT, paths: ['README.md'] }, busy)
    expect(await answer(batch)).toEqual([503, 'busy'])
  })

  it('answer unavailable when GitHub fails a file', async () => {
    const { cookie } = await signedIn()
    const repo = await added(cookie)
    await planOf(cookie, repo.id)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new Request(input, init).url
        return url.includes('raw.githubusercontent.com') || url.includes('/test-github/raw')
          ? new Response('oops', { status: 500 })
          : githubStubFetch(input, init)
      }) as typeof fetch,
    }
    const batch = await batchOf(cookie, repo.id, { commit: SAMPLE_COMMIT, paths: ['src/index.ts'] }, failing)
    expect(await answer(batch)).toEqual([502, 'unavailable'])
  })

  it('count one view each, within the 600 an hour', async () => {
    const { user, cookie } = await signedIn()
    const repo = await added(cookie)
    /** Adding the repository took one view. */
    for (let i = 0; i < REPO_VIEW_LIMIT.max - 3; i++) takeView(user.id)
    expect((await planOf(cookie, repo.id)).status).toBe(200)
    expect((await batchOf(cookie, repo.id, { commit: SAMPLE_COMMIT, paths: ['README.md'] })).status).toBe(200)
    expect(await answer(await planOf(cookie, repo.id))).toEqual([429, 'limited'])
    expect(await answer(await batchOf(cookie, repo.id, { commit: SAMPLE_COMMIT, paths: ['README.md'] }))).toEqual([
      429,
      'limited',
    ])
  })
})
