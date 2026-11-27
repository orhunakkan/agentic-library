import type { RepoFile, RepoView } from '~/shared/github-repos/contract'
import type { RepoOfflineFolder } from '~/shared/github-repos/offline'
import {
  decodeRepoSummary,
  encodeRepoSummary,
  parseRepoCopy,
  parseRepoFile,
  REPO_COPY_VERSION,
  REPO_SUMMARY_HEADER,
  REPOS_CACHE,
  type RepoCopy,
  type RepoCopySummary,
  repoCopyUrl,
  repoFileUrl,
  repoKeyOf,
  summaryOf,
} from '~/shared/offline/repo'
import { afterRemoval, type OfflineEnv, offlineEnv } from './store'

async function reposCache(env: OfflineEnv): Promise<Cache | null> {
  if (!env.caches || !(await env.caches.has(REPOS_CACHE))) return null
  return env.caches.open(REPOS_CACHE)
}

const pathnameOf = (request: Request) => new URL(request.url).pathname

const siteUrl = (path: string) => new URL(path, typeof location === 'undefined' ? 'http://localhost' : location.href)

const json = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { 'content-type': 'application/json', ...headers } })

export async function listRepoCopies(env: OfflineEnv = offlineEnv()): Promise<RepoCopySummary[]> {
  const cache = await reposCache(env)
  if (!cache) return []
  const copies: RepoCopySummary[] = []
  for (const request of await cache.keys()) {
    const key = repoKeyOf(pathnameOf(request))
    if (key?.kind !== 'copy') continue
    const summary = decodeRepoSummary((await cache.match(request))?.headers.get(REPO_SUMMARY_HEADER) ?? null)
    if (summary?.id === key.id) copies.push(summary)
  }
  return copies.sort((a, b) => b.savedAt - a.savedAt)
}

export async function readRepoCopy(id: string, env: OfflineEnv = offlineEnv()): Promise<RepoCopy | null> {
  const response = await (await reposCache(env))?.match(repoCopyUrl(id))
  if (!response) return null
  try {
    const copy = parseRepoCopy(await response.json())
    return copy?.id === id ? copy : null
  } catch {
    return null
  }
}

/** One file of a copy, as the server rendered it, or null when the copy doesn't hold it. */
export async function readRepoFile(
  copy: Pick<RepoCopy, 'id' | 'commit'>,
  path: string,
  env: OfflineEnv = offlineEnv(),
): Promise<RepoFile | null> {
  const response = await (await reposCache(env))?.match(repoFileUrl(copy.id, copy.commit, path))
  if (!response) return null
  try {
    const file = parseRepoFile(await response.json())
    return file?.path === path ? file : null
  } catch {
    return null
  }
}

/** Deletes every key of copy `id` that `drop` picks: its entry, or the files of one of its commits. */
async function removeKeys(cache: Cache, id: string, drop: (key: NonNullable<ReturnType<typeof repoKeyOf>>) => boolean) {
  for (const request of await cache.keys()) {
    const key = repoKeyOf(pathnameOf(request))
    if (key?.id === id && drop(key)) await cache.delete(request)
  }
}

export interface NewRepoCopy {
  id: string
  account: string
  repo: RepoView
  folders: RepoOfflineFolder[]
  /** Every file the batches must hold; the copy is saved only when each one is there. */
  files: readonly string[]
}

/**
 * Saves a copy from its batches of rendered files, writing the copy's entry last.
 *
 * The files go under the new commit's own prefix, so a copy already here keeps opening, whole, until the entry
 * switches to the new commit; only then are the old commit's files deleted. If a batch fails, `signal` aborts or
 * there's no room, only the new commit's files are deleted. A copy of the same commit is written over in place,
 * since its files are the same, and so is never deleted on a failure.
 */
export async function saveRepoCopy(
  copy: NewRepoCopy,
  batches: AsyncIterable<readonly RepoFile[]>,
  options: { signal?: AbortSignal } = {},
  env: OfflineEnv = offlineEnv(),
): Promise<RepoCopy> {
  if (!env.caches) throw new Error('Cache Storage is not available')
  const { signal } = options
  const { id, account, repo, folders } = copy
  const commit = repo.commit
  const cache = await env.caches.open(REPOS_CACHE)
  const current = await readRepoCopy(id, env)
  let bytes = 0
  let saved: RepoCopy
  try {
    for await (const files of batches) {
      signal?.throwIfAborted()
      for (const file of files) {
        const body = JSON.stringify(file)
        bytes += body.length
        await cache.put(repoFileUrl(id, commit, file.path), json(body))
      }
    }
    signal?.throwIfAborted()
    const held = new Set((await cache.keys()).map(pathnameOf))
    const missing = copy.files.find(
      (path) => !held.has(pathnameOf(new Request(siteUrl(repoFileUrl(id, commit, path))))),
    )
    if (missing !== undefined) throw new Error(`The copy is missing ${missing}`)
    const folderBytes = JSON.stringify(folders).length
    saved = { v: REPO_COPY_VERSION, id, account, repo, folders, commit, bytes: bytes + folderBytes, savedAt: env.now() }
    const summary = encodeRepoSummary(summaryOf(saved))
    await cache.put(repoCopyUrl(id), json(JSON.stringify(saved), { [REPO_SUMMARY_HEADER]: summary }))
  } catch (error) {
    if (current?.commit !== commit) await removeKeys(cache, id, (key) => key.kind === 'file' && key.commit === commit)
    if (!current) await afterRemoval(env)
    throw error
  }
  await removeKeys(cache, id, (key) => key.kind === 'file' && key.commit !== commit)
  return saved
}

export async function removeRepoCopy(id: string, env: OfflineEnv = offlineEnv()): Promise<void> {
  const cache = await reposCache(env)
  if (cache) await removeKeys(cache, id, () => true)
  await afterRemoval(env)
}

/** Deletes files no copy points to: a removed copy's, or a commit's that a closed tab left partway through an update. */
export async function sweepRepoOrphans(env: OfflineEnv = offlineEnv()): Promise<void> {
  const cache = await reposCache(env)
  if (cache) {
    const commits = new Map((await listRepoCopies(env)).map((c) => [c.id, c.commit]))
    for (const request of await cache.keys()) {
      const key = repoKeyOf(pathnameOf(request))
      if (!key) await cache.delete(request)
      else if (key.kind === 'copy' ? !commits.has(key.id) : commits.get(key.id) !== key.commit)
        await cache.delete(request)
    }
  }
  await afterRemoval(env)
}
