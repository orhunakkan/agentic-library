import { MB } from '../import/limits.ts'
import { endpoint } from '../lib/endpoint.ts'
import { isObject, only } from '../lib/json-shape.ts'
import type { RepoEntry, RepoErrorCode, RepoFile, RepoView } from './contract.ts'

/** The most files a repository may have to be downloaded: every entry that isn't a folder counts. */
export const MAX_OFFLINE_FILES = 2000

/** The most source bytes a download may fetch from GitHub, counted from the tree's sizes before anything is fetched. */
export const MAX_OFFLINE_BYTES = 20 * MB

/** The most paths one batch may ask the server to render. */
export const OFFLINE_BATCH_MAX = 40

/** One folder of the copy: its entries, and the path of the README it shows, which is among the copy's files. */
export interface RepoOfflineFolder {
  path: string
  entries: RepoEntry[]
  readme: string | null
}

/** What the server will render for a copy, at `repo.commit`: every folder, every file, and the bytes it will fetch. */
export interface RepoOfflinePlan {
  repo: RepoView
  folders: RepoOfflineFolder[]
  files: string[]
  bytes: number
}

export interface RepoOfflineBatchBody {
  commit: string
  paths: string[]
}

export interface RepoOfflineBatch {
  files: RepoFile[]
}

/**
 * Why a repository is too big to download. `files` and `bytes` are null when GitHub sent only part of the tree,
 * so the real numbers aren't known.
 */
export interface RepoTooLarge {
  files: number | null
  bytes: number | null
  maxFiles: number
  maxBytes: number
}

/** `too_large`: past the caps. `changed`: the batch names a commit the repository is no longer pinned to. */
export type RepoOfflineErrorCode = RepoErrorCode | 'too_large' | 'changed'

export type RepoOfflineRefusal =
  | { error: Exclude<RepoOfflineErrorCode, 'too_large' | 'busy'> }
  | ({ error: 'too_large' } & RepoTooLarge)
  | { error: 'busy'; retryAt: string | null }

const COMMIT = /^[0-9a-f]{40}$/
const PATH_MAX = 1024

const isBatchPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= PATH_MAX

export function parseOfflineBatch(value: unknown): RepoOfflineBatchBody | null {
  if (!isObject(value) || !only(value, ['commit', 'paths'])) return null
  const { commit, paths } = value
  if (typeof commit !== 'string' || !COMMIT.test(commit)) return null
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > OFFLINE_BATCH_MAX) return null
  if (!paths.every(isBatchPath) || new Set(paths).size !== paths.length) return null
  return { commit, paths }
}

export const repoOfflineHref = (id: string) => `/account/repos/${encodeURIComponent(id)}/offline`

export const repoOfflineBatch = (id: string) =>
  endpoint<RepoOfflineBatchBody, RepoOfflineBatch, RepoOfflineRefusal>()({
    path: repoOfflineHref(id),
    parse: parseOfflineBatch,
  })
