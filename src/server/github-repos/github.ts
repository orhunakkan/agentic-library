import '@tanstack/react-start/server-only'
import { KB, MB } from '../../shared/import/limits.ts'
import { getConfig } from '../config.ts'
import { fetchCapped } from '../outbound.ts'
import { type ParsedTree, parseCommitSha, parseRateLimit, parseRepo, parseTree, type RepoInfo } from './github-parse.ts'

export type GitHubProblem = 'not-found' | 'empty' | 'busy' | 'unavailable' | 'too-large'
export type GitHubResult<T> = { ok: true; value: T } | { ok: false; problem: GitHubProblem; retryAt?: Date }

export interface GitHubOptions {
  fetch?: typeof fetch
}

const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 2
export const MAX_IN_FLIGHT = 6
const REPO_MAX_BYTES = 64 * KB
const SHA_MAX_BYTES = 4 * KB
const TREE_MAX_BYTES = 8 * MB
const DEFAULT_BACKOFF_MS = 60_000
const ETAGS_MAX = 5000
const API_STATUSES = [304, 403, 409, 422, 429] as const
const GITHUB_JSON = 'application/vnd.github+json'

export function userAgent(): string {
  return `Folio (+${getConfig().appOrigin})`
}

let inFlight = 0
let blockedUntil = 0
const etags = new Map<string, { etag: string; sha: string }>()

export function resetGitHub(): void {
  inFlight = 0
  blockedUntil = 0
  etags.clear()
}

export const requestsInFlight = () => inFlight

export function limitedUntil(now = Date.now()): Date | null {
  return blockedUntil > now ? new Date(blockedUntil) : null
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')
const repoPath = (owner: string, name: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`

const sameHost = (base: string) => {
  const b = new URL(base)
  return (target: URL) => target.protocol === b.protocol && target.host === b.host
}

interface Answer {
  status: number
  body: Uint8Array
}

async function api(
  path: string,
  shape: string,
  accept: string,
  maxBytes: number,
  options: GitHubOptions,
  headers: Record<string, string> = {},
): Promise<GitHubResult<Answer & { headers: Headers }>> {
  const limited = limitedUntil()
  if (limited) return { ok: false, problem: 'busy', retryAt: limited }
  if (inFlight >= MAX_IN_FLIGHT) return { ok: false, problem: 'busy' }
  const { githubApiBase, githubToken } = getConfig()
  inFlight++
  try {
    const answer = await fetchCapped(`${githubApiBase}${path}`, {
      accept,
      maxBytes,
      timeoutMs: TIMEOUT_MS,
      redirects: MAX_REDIRECTS,
      allowRedirect: sameHost(githubApiBase),
      userAgent: userAgent(),
      headers: {
        'x-github-api-version': '2022-11-28',
        ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
        ...headers,
      },
      passStatuses: API_STATUSES,
      log: { label: 'github', path: () => shape },
      fetch: options.fetch,
    })
    if (!answer.ok) return answer
    if (answer.status === 403 || answer.status === 429) {
      const limit = parseRateLimit(answer.headers)
      const used = limit.remaining === 0 || limit.retryAt !== null || answer.status === 429
      if (!used) return { ok: false, problem: 'unavailable' }
      const until = limit.retryAt ?? (limit.remaining === 0 ? limit.resetAt : null)
      blockedUntil = Math.max(blockedUntil, until?.getTime() ?? Date.now() + DEFAULT_BACKOFF_MS)
      return { ok: false, problem: 'busy', retryAt: new Date(blockedUntil) }
    }
    return { ok: true, value: answer }
  } finally {
    inFlight--
  }
}

function json(answer: Answer): unknown {
  try {
    return JSON.parse(Buffer.from(answer.body).toString('utf8'))
  } catch {
    return undefined
  }
}

const unavailable = { ok: false, problem: 'unavailable' } as const

function repoAnswer(answer: GitHubResult<Answer>): GitHubResult<RepoInfo> {
  if (!answer.ok) return answer
  if (answer.value.status !== 200) return unavailable
  const repo = parseRepo(json(answer.value))
  if (repo === 'private') return { ok: false, problem: 'not-found' }
  return repo ? { ok: true, value: repo } : unavailable
}

export async function getRepo(
  owner: string,
  name: string,
  options: GitHubOptions = {},
): Promise<GitHubResult<RepoInfo>> {
  return repoAnswer(await api(repoPath(owner, name), '/repos/:o/:r', GITHUB_JSON, REPO_MAX_BYTES, options))
}

export async function getRepoById(githubId: number, options: GitHubOptions = {}): Promise<GitHubResult<RepoInfo>> {
  return repoAnswer(await api(`/repositories/${githubId}`, '/repositories/:id', GITHUB_JSON, REPO_MAX_BYTES, options))
}

export async function resolveRef(
  owner: string,
  name: string,
  ref: string,
  options: GitHubOptions = {},
): Promise<GitHubResult<string>> {
  const path = `${repoPath(owner, name)}/commits/${encodePath(ref)}`
  const known = etags.get(path)
  const answer = await api(
    path,
    '/repos/:o/:r/commits/:ref',
    'application/vnd.github.sha',
    SHA_MAX_BYTES,
    options,
    known ? { 'if-none-match': known.etag } : {},
  )
  if (!answer.ok) return answer
  const { status } = answer.value
  if (status === 304 && known) return { ok: true, value: known.sha }
  if (status === 422) return { ok: false, problem: 'not-found' }
  if (status === 409) return { ok: false, problem: 'empty' }
  if (status !== 200) return unavailable
  const sha = parseCommitSha(Buffer.from(answer.value.body).toString('utf8'))
  if (!sha) return unavailable
  const etag = answer.value.headers.get('etag')
  if (etag) {
    etags.delete(path)
    etags.set(path, { etag, sha })
    while (etags.size > ETAGS_MAX) etags.delete(etags.keys().next().value as string)
  }
  return { ok: true, value: sha }
}

export async function getTree(
  owner: string,
  name: string,
  sha: string,
  { recursive }: { recursive: boolean },
  options: GitHubOptions = {},
): Promise<GitHubResult<ParsedTree>> {
  const path = `${repoPath(owner, name)}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`
  const answer = await api(path, '/repos/:o/:r/git/trees/:sha', GITHUB_JSON, TREE_MAX_BYTES, options)
  if (!answer.ok) return answer
  if (answer.value.status === 409) return { ok: false, problem: 'empty' }
  if (answer.value.status !== 200) return unavailable
  const tree = parseTree(json(answer.value))
  return tree ? { ok: true, value: tree } : unavailable
}

export async function getRaw(
  owner: string,
  name: string,
  commit: string,
  path: string,
  maxBytes: number,
  options: GitHubOptions = {},
): Promise<GitHubResult<Uint8Array>> {
  if (inFlight >= MAX_IN_FLIGHT) return { ok: false, problem: 'busy' }
  const { githubRawBase } = getConfig()
  inFlight++
  try {
    const url = `${githubRawBase}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${commit}/${encodePath(path)}`
    const answer = await fetchCapped(url, {
      accept: '*/*',
      maxBytes,
      timeoutMs: TIMEOUT_MS,
      redirects: MAX_REDIRECTS,
      allowRedirect: sameHost(githubRawBase),
      userAgent: userAgent(),
      log: { label: 'github raw', path: () => '/:o/:r/:commit/:path' },
      fetch: options.fetch,
    })
    return answer.ok ? { ok: true, value: answer.body } : answer
  } finally {
    inFlight--
  }
}
