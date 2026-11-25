import { isObject } from '../../shared/lib/json-shape.ts'

export interface RepoInfo {
  githubId: number
  owner: string
  name: string
  defaultBranch: string
  description: string | null
}

export type TreeEntryType = 'blob' | 'tree' | 'commit'

export interface TreeEntry {
  path: string
  mode: string
  type: TreeEntryType
  sha: string
  size: number | null
}

export interface ParsedTree {
  sha: string
  truncated: boolean
  entries: TreeEntry[]
}

export const DESCRIPTION_MAX = 350

const SHA = /^[0-9a-f]{40}$/
export const isSha = (value: unknown): value is string => typeof value === 'string' && SHA.test(value)

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= max

export function parseRepo(value: unknown): RepoInfo | 'private' | null {
  if (!isObject(value)) return null
  const { id, full_name: fullName, default_branch: defaultBranch, description } = value
  if (value.private !== false || (value.visibility !== undefined && value.visibility !== 'public')) return 'private'
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null
  if (typeof fullName !== 'string') return null
  const [owner, name, ...more] = fullName.split('/')
  if (more.length || !text(owner, 39) || !text(name, 100)) return null
  if (!text(defaultBranch, 255)) return null
  const cleaned = typeof description === 'string' ? description.trim().slice(0, DESCRIPTION_MAX) : ''
  return { githubId: id, owner, name, defaultBranch, description: cleaned || null }
}

export function parseCommitSha(body: string): string | null {
  const sha = body.trim()
  return SHA.test(sha) ? sha : null
}

function parseEntry(value: unknown): TreeEntry | null {
  if (!isObject(value)) return null
  const { path, mode, type, sha, size } = value
  if (typeof path !== 'string' || !path || path.length > 4096 || path.startsWith('/') || path.includes('\0'))
    return null
  if (path.split('/').some((s) => s === '' || s === '.' || s === '..')) return null
  if (typeof mode !== 'string' || !/^[0-7]{6}$/.test(mode)) return null
  if (type !== 'blob' && type !== 'tree' && type !== 'commit') return null
  if (!isSha(sha)) return null
  if (type === 'blob' && (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)) return null
  return { path, mode, type, sha, size: type === 'blob' ? (size as number) : null }
}

export function parseTree(value: unknown): ParsedTree | null {
  if (!isObject(value) || !isSha(value.sha) || typeof value.truncated !== 'boolean' || !Array.isArray(value.tree))
    return null
  const entries: TreeEntry[] = []
  for (const raw of value.tree) {
    const entry = parseEntry(raw)
    if (!entry) return null
    entries.push(entry)
  }
  return { sha: value.sha, truncated: value.truncated, entries }
}

export interface RateLimit {
  remaining: number | null
  resetAt: Date | null
  retryAt: Date | null
}

const headerInt = (headers: Headers, name: string): number | null => {
  const value = headers.get(name)
  return value !== null && /^\d{1,12}$/.test(value.trim()) ? Number(value.trim()) : null
}

export function parseRateLimit(headers: Headers, now = Date.now()): RateLimit {
  const remaining = headerInt(headers, 'x-ratelimit-remaining')
  const reset = headerInt(headers, 'x-ratelimit-reset')
  const retryAfter = headerInt(headers, 'retry-after')
  return {
    remaining,
    resetAt: reset === null ? null : new Date(reset * 1000),
    retryAt: retryAfter === null ? null : new Date(now + retryAfter * 1000),
  }
}
