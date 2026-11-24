import { type ChangeResult, post } from '~/client/lib/post'
import type { RepoUrlProblem, RepoView } from '~/shared/github-repos/contract'
import type { RepoProblem } from './repo-messages'

export interface RepoFailure {
  problem: RepoProblem
  existingId?: string
  retryAt?: string | null
}

export type RepoResult<T> = ChangeResult<T, RepoProblem> & { failure?: RepoFailure }

const URL_PROBLEMS: readonly RepoUrlProblem[] = ['empty', 'too_long', 'not_url', 'not_github', 'not_repository']
const CODES: readonly RepoProblem[] = [
  'signed_out',
  'not_found',
  'ref_not_found',
  'exists',
  'quota',
  'limited',
  'busy',
  'unavailable',
  'failed',
]

const failed = (failure: RepoFailure): RepoResult<never> => ({ ok: false, problem: failure.problem, failure })

export async function readRepoAnswer<T>(
  response: Response,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<RepoResult<T>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.ok) {
    const value = pick(body)
    return value === undefined ? failed({ problem: 'failed' }) : { ok: true, value }
  }
  const { error, reason } = body
  if (error === 'invalid') return failed({ problem: URL_PROBLEMS.find((p) => p === reason) ?? 'failed' })
  const problem = CODES.find((c) => c === error) ?? 'failed'
  if (problem === 'exists' && typeof body.id === 'string') return failed({ problem, existingId: body.id })
  if (problem === 'busy') return failed({ problem, retryAt: typeof body.retryAt === 'string' ? body.retryAt : null })
  return failed({ problem })
}

async function send<T>(
  path: string,
  body: unknown,
  pick: (body: Record<string, unknown>) => T | undefined,
): Promise<RepoResult<T>> {
  let response: Response
  try {
    response = await post(path, body)
  } catch {
    return failed({ problem: 'unavailable' })
  }
  return readRepoAnswer(response, pick)
}

const repoOf = (body: Record<string, unknown>) =>
  body.repo && typeof body.repo === 'object' ? (body.repo as RepoView) : undefined

const repoPath = (id: string) => `/account/repos/${encodeURIComponent(id)}`

export function addRepo(url: string): Promise<RepoResult<{ repo: RepoView; path: string }>> {
  return send('/account/repos/new', { url }, (b) => {
    const repo = repoOf(b)
    return repo ? { repo, path: typeof b.path === 'string' ? b.path : '' } : undefined
  })
}

export function refreshRepo(id: string): Promise<RepoResult<{ repo: RepoView; changed: boolean }>> {
  return send(repoPath(id), { intent: 'refresh' }, (b) => {
    const repo = repoOf(b)
    return repo ? { repo, changed: b.changed === true } : undefined
  })
}

export function removeRepo(id: string): Promise<RepoResult<true>> {
  return send(repoPath(id), { intent: 'remove' }, (b) => (b.removed === true ? true : undefined))
}

export function repoHref(id: string, path = '', view: 'preview' | 'code' = 'preview', anchor: string | null = null) {
  const params = new URLSearchParams()
  if (path) params.set('path', path)
  if (view === 'code') params.set('view', 'code')
  const query = params.toString()
  return `${repoPath(id)}${query ? `?${query}` : ''}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`
}

export const repoRawHref = (id: string, path: string) => `${repoPath(id)}/raw?${new URLSearchParams({ path })}`
