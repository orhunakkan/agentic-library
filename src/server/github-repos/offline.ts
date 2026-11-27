import '@tanstack/react-start/server-only'
import type { RepoFile } from '../../shared/github-repos/contract.ts'
import {
  MAX_OFFLINE_BYTES,
  MAX_OFFLINE_FILES,
  type RepoOfflineErrorCode,
  type RepoOfflineFolder,
  type RepoOfflinePlan,
  type RepoOfflineRefusal,
  type RepoTooLarge,
  repoOfflineBatch,
} from '../../shared/github-repos/offline.ts'
import { noStoreJson } from '../auth.ts'
import { signedInEndpoints } from '../signed-in.ts'
import { treeKey } from './actions.ts'
import {
  childrenOf,
  classifyEntry,
  type RawFetch,
  type RenderProblem,
  type RenderTarget,
  type RepoTree,
  readmeOf,
  renderFile,
} from './files.ts'
import { type GitHubOptions, type GitHubProblem, getRaw } from './github.ts'
import type { TreeEntry } from './github-parse.ts'
import { isRepoId } from './input.ts'
import { takeView } from './pacing.ts'
import { findRepo, type RepoRow } from './store.ts'
import { loadTree } from './trees.ts'
import { EMPTY_COMMIT, toRepoView } from './view.ts'

/** How many files one batch renders at once: GitHub's in-flight share is shared with everyone browsing repositories. */
export const OFFLINE_RENDERS = 2

const BATCH_BODY_BYTES = 64 * 1024

const offline = signedInEndpoints<RepoOfflineErrorCode, RepoOfflineRefusal>({ maxBytes: BATCH_BODY_BYTES })
const { fail } = offline
const notFound = () => fail(404, 'not_found')

type Problem = { ok: false; problem: GitHubProblem | string; retryAt?: Date }

function githubFailure(problem: Problem): Response {
  if (problem.problem === 'busy') return fail(503, 'busy', { retryAt: problem.retryAt?.toISOString() ?? null })
  return fail(502, 'unavailable')
}

export type PlanResult = { ok: true; plan: Omit<RepoOfflinePlan, 'repo'> } | { ok: false; tooLarge: RepoTooLarge }

const caps = { maxFiles: MAX_OFFLINE_FILES, maxBytes: MAX_OFFLINE_BYTES }

/** Every folder and file of a whole tree, folder by folder, or why it's too large to download. */
export function planOffline(tree: RepoTree): PlanResult {
  if (!tree.complete) return { ok: false, tooLarge: { files: null, bytes: null, ...caps } }
  const folders: RepoOfflineFolder[] = []
  const files: string[] = []
  let bytes = 0
  const paths = [...tree.folders.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const path of paths) {
    const entries = childrenOf(tree, path) ?? []
    folders.push({ path, entries, readme: readmeOf(entries)?.path ?? null })
    for (const entry of entries) if (entry.kind !== 'folder') files.push(entry.path)
  }
  for (const path of files) {
    const entry = tree.byPath.get(path)
    const kind = entry ? classifyEntry(entry) : null
    if (kind?.kind === 'fetch' || kind?.kind === 'link') bytes += entry?.size ?? 0
  }
  if (files.length > MAX_OFFLINE_FILES || bytes > MAX_OFFLINE_BYTES)
    return { ok: false, tooLarge: { files: files.length, bytes, ...caps } }
  return { ok: true, plan: { folders, files, bytes } }
}

/** The tree's entries for a batch's paths, in order, or null when one isn't a file in the tree. */
export function batchEntries(tree: RepoTree, paths: readonly string[]): TreeEntry[] | null {
  const entries: TreeEntry[] = []
  for (const path of paths) {
    const entry = tree.byPath.get(path)
    if (!entry || entry.type === 'tree') return null
    entries.push(entry)
  }
  return entries
}

/** Renders each entry as the preview page does, `OFFLINE_RENDERS` at a time, stopping at the first problem. */
export async function renderBatch(
  entries: readonly TreeEntry[],
  target: RenderTarget,
  fetchRaw: RawFetch,
): Promise<{ ok: true; value: RepoFile[] } | RenderProblem> {
  const files: RepoFile[] = new Array(entries.length)
  let next = 0
  let problem: RenderProblem | null = null
  const worker = async () => {
    while (!problem && next < entries.length) {
      const index = next++
      const entry = entries[index] as TreeEntry
      const file = await renderFile(entry, 'preview', target, fetchRaw)
      if (file.ok) files[index] = file.value
      else problem ??= file
    }
  }
  await Promise.all(Array.from({ length: Math.min(OFFLINE_RENDERS, entries.length) }, worker))
  return problem ?? { ok: true, value: files }
}

type Opened = { ok: true; row: RepoRow; tree: RepoTree } | { ok: false; response: Response }

/** The signed-in reader's repository and its whole tree, counting one view, or the refusal to answer. */
async function openForOffline(
  db: Parameters<typeof findRepo>[0],
  userId: number,
  id: string,
  options: GitHubOptions,
  commit?: string,
): Promise<Opened> {
  const row = await findRepo(db, userId, id)
  if (!row || row.commitSha === EMPTY_COMMIT) return { ok: false, response: notFound() }
  if (commit !== undefined && commit !== row.commitSha) return { ok: false, response: fail(409, 'changed') }
  if (takeView(userId)) return { ok: false, response: fail(429, 'limited') }
  const tree = await loadTree(treeKey(row), options)
  if (!tree.ok) return { ok: false, response: tree.problem === 'not-found' ? notFound() : githubFailure(tree) }
  return { ok: true, row, tree: tree.value }
}

const checkId = (id: string) => () => (isRepoId(id) ? undefined : notFound())

export const handleRepoOfflinePlan = (request: Request, id: string, options: GitHubOptions = {}) =>
  offline.post(request, { log: 'repo offline plan', body: 'none', before: checkId(id) }, async ({ session, db }) => {
    const opened = await openForOffline(db, session.userId, id, options)
    if (!opened.ok) return opened.response
    const planned = planOffline(opened.tree)
    if (!planned.ok) return fail(413, 'too_large', planned.tooLarge)
    const plan: RepoOfflinePlan = { repo: toRepoView(opened.row), ...planned.plan }
    return noStoreJson(200, plan)
  })

export const handleRepoOfflineBatch = (request: Request, id: string, options: GitHubOptions = {}) =>
  offline.serve(
    repoOfflineBatch(id),
    request,
    { log: 'repo offline batch', before: checkId(id) },
    async ({ session, db, input }) => {
      const opened = await openForOffline(db, session.userId, id, options, input.commit)
      if (!opened.ok) return opened.response
      const { row, tree } = opened
      const entries = batchEntries(tree, input.paths)
      if (!entries) return fail(400, 'invalid')
      const target: RenderTarget = { owner: row.owner, name: row.name, commit: row.commitSha, tree }
      const fetchRaw: RawFetch = (path, maxBytes) => getRaw(row.owner, row.name, row.commitSha, path, maxBytes, options)
      const rendered = await renderBatch(entries, target, fetchRaw)
      if (!rendered.ok) return githubFailure(rendered)
      return { status: 200, answer: { files: rendered.value } }
    },
  )
