import type { RepoFile, RepoView } from '../github-repos/contract'
import type { RepoOfflineFolder, RepoOfflinePlan, RepoTooLarge } from '../github-repos/offline'
import {
  isPictureName,
  MAX_OFFLINE_PICTURE_BYTES,
  MAX_OFFLINE_PICTURES,
  PICTURE_MAX_BYTES,
} from '../github-repos/pictures'
import { isObject } from '../lib/json-shape'
import { isUuid } from '../uuid'

export const REPOS_CACHE = 'folio-repos-v1'
export const REPO_COPY_VERSION = 1
export const REPO_SUMMARY_HEADER = 'x-folio-repo'

const ROOT = '/offline-repos/'
const COMMIT = /^[0-9a-f]{40}$/

/** A downloaded repository: what its page needs to put every folder together, at one commit, for one account. */
export interface RepoCopy {
  v: typeof REPO_COPY_VERSION
  id: string
  account: string
  repo: RepoView
  folders: RepoOfflineFolder[]
  commit: string
  bytes: number
  savedAt: number
  /** The pictures kept with the copy, which show offline. */
  pictures: string[]
  /** True when the repository had more pictures than a download keeps, so it kept none. */
  picturesSkipped: boolean
}

/** What a list of copies shows, kept in the copy entry's header so listing never reads the folders. */
export interface RepoCopySummary {
  id: string
  account: string
  owner: string
  name: string
  commit: string
  bytes: number
  savedAt: number
  picturesSkipped: boolean
}

export const repoCopyUrl = (id: string) => `${ROOT}${id}.json`

/** A copy's key in the offline-checked stamps, beside the private books' slugs. */
export const REPO_CHECK_PREFIX = 'repo:'
export const repoCheckKey = (id: string) => `${REPO_CHECK_PREFIX}${id}`

/** Each commit's files sit under a prefix of their own, so an update never writes over the copy it replaces. */
export const repoCommitPrefix = (id: string, commit: string) => `${ROOT}${id}/${commit}/`

export const repoFileUrl = (id: string, commit: string, path: string) =>
  `${repoCommitPrefix(id, commit)}files/${encodeURIComponent(path)}.json`

/** A picture of one commit, kept as the raw route answered it. */
export const repoPictureUrl = (id: string, commit: string, path: string) =>
  `${repoCommitPrefix(id, commit)}raw/${encodeURIComponent(path)}`

/** What a key in the repositories cache holds: a copy entry, a file of one commit, or neither. */
export type RepoKey = { kind: 'copy'; id: string } | { kind: 'file'; id: string; commit: string } | null

export function repoKeyOf(pathname: string): RepoKey {
  if (!pathname.startsWith(ROOT)) return null
  const rest = pathname.slice(ROOT.length)
  if (rest.endsWith('.json') && !rest.includes('/')) {
    const id = rest.slice(0, -'.json'.length)
    return isUuid(id) ? { kind: 'copy', id } : null
  }
  const [id, commit] = rest.split('/')
  return id && commit && isUuid(id) && COMMIT.test(commit) ? { kind: 'file', id, commit } : null
}

const isId = (value: unknown): value is string => typeof value === 'string' && isUuid(value)

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function summaryOf(copy: RepoCopy): RepoCopySummary {
  const { id, account, repo, commit, bytes, savedAt, picturesSkipped } = copy
  return { id, account, owner: repo.owner, name: repo.name, commit, bytes, savedAt, picturesSkipped }
}

export const encodeRepoSummary = (summary: RepoCopySummary) => encodeURIComponent(JSON.stringify(summary))

export function decodeRepoSummary(value: string | null): RepoCopySummary | null {
  if (!value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeURIComponent(value))
  } catch {
    return null
  }
  if (!isObject(parsed)) return null
  const { id, account, owner, name, commit, bytes, savedAt } = parsed
  if (!isId(id) || typeof account !== 'string' || account === '') return null
  if (typeof owner !== 'string' || typeof name !== 'string') return null
  if (typeof commit !== 'string' || !COMMIT.test(commit) || !isCount(bytes) || !isCount(savedAt)) return null
  return { id, account, owner, name, commit, bytes, savedAt, picturesSkipped: parsed.picturesSkipped === true }
}

const isEntry = (value: unknown) =>
  isObject(value) &&
  typeof value.name === 'string' &&
  typeof value.path === 'string' &&
  (value.kind === 'folder' || value.kind === 'file' || value.kind === 'link' || value.kind === 'submodule')

const isFolder = (value: unknown) =>
  isObject(value) &&
  typeof value.path === 'string' &&
  Array.isArray(value.entries) &&
  value.entries.every(isEntry) &&
  (value.readme === null || typeof value.readme === 'string')

export function parseRepoCopy(value: unknown): RepoCopy | null {
  if (!isObject(value) || value.v !== REPO_COPY_VERSION) return null
  const { id, account, repo, folders, commit, bytes, savedAt } = value
  if (!isId(id) || typeof account !== 'string' || account === '') return null
  if (typeof commit !== 'string' || !COMMIT.test(commit) || !isCount(bytes) || !isCount(savedAt)) return null
  if (!isObject(repo) || repo.id !== id || repo.commit !== commit) return null
  if (typeof repo.owner !== 'string' || typeof repo.name !== 'string') return null
  if (!Array.isArray(folders) || !folders.every(isFolder)) return null
  /** A copy saved before downloads kept pictures has neither field, and keeps no pictures. */
  const { pictures = [], picturesSkipped = false } = value
  if (!Array.isArray(pictures) || !pictures.every((p) => typeof p === 'string')) return null
  return { ...(value as unknown as RepoCopy), pictures, picturesSkipped: picturesSkipped === true }
}

const CONTENT_KINDS = ['markdown', 'code', 'picture', 'notice']

export function parseRepoFile(value: unknown): RepoFile | null {
  if (!isObject(value) || typeof value.path !== 'string' || typeof value.name !== 'string') return null
  if (!isCount(value.size) || (value.lines !== null && !isCount(value.lines))) return null
  const { content } = value
  if (!isObject(content) || typeof content.kind !== 'string' || !CONTENT_KINDS.includes(content.kind)) return null
  if (content.kind === 'markdown' && content.view === 'preview' && !isObject(content.markdown)) return null
  if ((content.kind === 'code' || (content.kind === 'markdown' && content.view === 'code')) && !isObject(content.code))
    return null
  if (content.kind === 'notice' && typeof content.notice !== 'string') return null
  return value as unknown as RepoFile
}

const isPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** The server's plan for a copy of repository `id`, checked before the download relies on it. */
export function parseOfflinePlan(value: unknown, id: string): RepoOfflinePlan | null {
  if (!isObject(value)) return null
  const { repo, folders, files, bytes } = value
  if (!isObject(repo) || repo.id !== id || typeof repo.commit !== 'string' || !COMMIT.test(repo.commit)) return null
  if (typeof repo.owner !== 'string' || typeof repo.name !== 'string') return null
  if (!Array.isArray(folders) || !folders.every(isFolder)) return null
  if (!Array.isArray(files) || !files.every(isPath) || !isCount(bytes)) return null
  return value as unknown as RepoOfflinePlan
}

const isCountOrNull = (value: unknown) => value === null || isCount(value)

export function parseTooLarge(value: unknown): RepoTooLarge | null {
  if (!isObject(value) || value.error !== 'too_large') return null
  const { files, bytes, maxFiles, maxBytes } = value
  if (!isCountOrNull(files) || !isCountOrNull(bytes) || !isCount(maxFiles) || !isCount(maxBytes)) return null
  return { files: files as number | null, bytes: bytes as number | null, maxFiles, maxBytes }
}

/** A batch's files, checked to be the paths it asked for, in their order. */
export function parseBatchFiles(value: unknown, paths: readonly string[]): RepoFile[] | null {
  if (!isObject(value) || !Array.isArray(value.files) || value.files.length !== paths.length) return null
  const files: RepoFile[] = []
  for (const [i, item] of value.files.entries()) {
    const file = parseRepoFile(item)
    if (!file || file.path !== paths[i]) return null
    files.push(file)
  }
  return files
}

/**
 * The pictures a download keeps: each file the page shows as a picture, unless there are more than 200 of them or
 * more than 30 MB, when it keeps none.
 */
export function planPictures(plan: Pick<RepoOfflinePlan, 'folders'>): {
  paths: string[]
  bytes: number
  skipped: boolean
} {
  const paths: string[] = []
  let bytes = 0
  for (const folder of plan.folders)
    for (const entry of folder.entries) {
      const size = entry.size ?? 0
      if (entry.kind !== 'file' || !isPictureName(entry.name) || size > PICTURE_MAX_BYTES) continue
      paths.push(entry.path)
      bytes += size
    }
  if (paths.length > MAX_OFFLINE_PICTURES || bytes > MAX_OFFLINE_PICTURE_BYTES)
    return { paths: [], bytes: 0, skipped: true }
  return { paths, bytes, skipped: false }
}
