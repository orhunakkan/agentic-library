import '@tanstack/react-start/server-only'
import {
  MAX_REPOS,
  type RepoEntry,
  type RepoErrorCode,
  type RepoFolderState,
  type RepoReadProblem,
  type ReposState,
  type RepoTarget,
  type RepoViewState,
} from '../../shared/github-repos/contract.ts'
import { parseRepoUrl } from '../../shared/github-repos/github-url.ts'
import { isSvg, sniffImage } from '../../shared/import/image.ts'
import { recordEvent } from '../audit.ts'
import { noStoreJson, requestIp, sessionForRequest } from '../auth.ts'
import { type Db, getDb, isDatabaseConfigured, type Pool } from '../db.ts'
import { take } from '../quota.ts'
import { logError } from '../redact.ts'
import { signedInEndpoints, signedInRead } from '../signed-in.ts'
import {
  childrenOf,
  isPictureName,
  LINK_MODE,
  PICTURE_MAX_BYTES,
  parentOf,
  type RawFetch,
  type RenderTarget,
  renderFile,
  renderFolder,
} from './files.ts'
import {
  type GitHubOptions,
  type GitHubProblem,
  type GitHubResult,
  getRaw,
  getRepo,
  getRepoById,
  resolveRef,
} from './github.ts'
import type { RepoInfo } from './github-parse.ts'
import { isRepoId, parseAdd, parsePath, parseRepoAction } from './input.ts'
import { takeView } from './pacing.ts'
import {
  addRepo,
  findRepo,
  listRepos,
  markChecked,
  markGone,
  markOpened,
  type RefKind,
  type RepoRow,
  removeRepo,
} from './store.ts'
import { loadFolder, loadTree, type TreeKey } from './trees.ts'
import { EMPTY_COMMIT, toRepoView } from './view.ts'

const ADD_BODY_BYTES = 2 * 1024
const ACTION_BODY_BYTES = 1024
export const STALE_MS = 60 * 60_000

const repos = signedInEndpoints<RepoErrorCode>({ maxBytes: ACTION_BODY_BYTES })
const { fail } = repos
const notFound = () => fail(404, 'not_found')

type Problem = { ok: false; problem: GitHubProblem; retryAt?: Date }

function githubFailure(problem: Problem): Response {
  if (problem.problem === 'busy') return fail(503, 'busy', { retryAt: problem.retryAt?.toISOString() ?? null })
  return fail(502, 'unavailable')
}

const readProblem = (problem: Problem): RepoReadProblem =>
  problem.problem === 'busy'
    ? { state: 'busy', retryAt: problem.retryAt?.toISOString() ?? null }
    : { state: 'unavailable' }

interface ResolvedRef {
  ref: string | null
  refKind: RefKind | null
  commit: string
  path: string
}

const FULL_SHA = /^[0-9a-f]{40}$/
const SHORT_SHA = /^[0-9a-f]{7,39}$/

async function resolveNamedRef(
  info: RepoInfo,
  ref: string,
  options: GitHubOptions,
): Promise<GitHubResult<{ kind: RefKind; commit: string }>> {
  if (!FULL_SHA.test(ref)) {
    const branch = await resolveRef(info.owner, info.name, `heads/${ref}`, options)
    if (branch.ok) return { ok: true, value: { kind: 'branch', commit: branch.value } }
    if (branch.problem !== 'not-found') return branch
  }
  const plain = await resolveRef(info.owner, info.name, ref, options)
  if (!plain.ok) return plain
  const kind: RefKind = FULL_SHA.test(ref) || (SHORT_SHA.test(ref) && plain.value.startsWith(ref)) ? 'commit' : 'tag'
  return { ok: true, value: { kind, commit: plain.value } }
}

async function resolveAddress(
  info: RepoInfo,
  mode: 'tree' | 'blob' | null,
  segments: readonly string[],
  options: GitHubOptions,
): Promise<GitHubResult<ResolvedRef> | { ok: false; problem: 'ref-not-found' }> {
  if (mode === null) {
    const head = await resolveRef(info.owner, info.name, info.defaultBranch, options)
    if (head.ok) return { ok: true, value: { ref: null, refKind: null, commit: head.value, path: '' } }
    if (head.problem === 'empty')
      return { ok: true, value: { ref: null, refKind: null, commit: EMPTY_COMMIT, path: '' } }
    return head.problem === 'not-found' ? { ok: false, problem: 'ref-not-found' } : head
  }
  const most = Math.min(3, mode === 'blob' ? segments.length - 1 : segments.length)
  for (let segmentCount = 1; segmentCount <= most; segmentCount++) {
    const ref = segments.slice(0, segmentCount).join('/')
    if (ref.length > 255) break
    const found = await resolveNamedRef(info, ref, options)
    if (found.ok)
      return {
        ok: true,
        value: {
          ref,
          refKind: found.value.kind,
          commit: found.value.commit,
          path: segments.slice(segmentCount).join('/'),
        },
      }
    if (found.problem === 'empty') return { ok: false, problem: 'ref-not-found' }
    if (found.problem !== 'not-found') return found
  }
  return { ok: false, problem: 'ref-not-found' }
}

function parseAddress(value: unknown) {
  const input = parseAdd(value)
  if (!input) return null
  const address = parseRepoUrl(input.url)
  return address.ok ? address : fail(400, 'invalid', { reason: address.reason })
}

export const handleRepoAdd = (request: Request, options: GitHubOptions = {}) =>
  repos.post(
    request,
    { log: 'repo add', body: { json: ADD_BODY_BYTES }, parse: parseAddress },
    async ({ session, db, input: address }) => {
      const { userId } = session
      if (takeView(userId)) return fail(429, 'limited')
      const taken = await take(db, userId, 'repo-add', { ip: requestIp(request) })
      if (!taken.ok) return fail(429, 'limited')
      const info = await getRepo(address.owner, address.name, options)
      if (!info.ok) {
        await taken.settle({ problem: info.problem })
        return info.problem === 'not-found' ? notFound() : githubFailure(info)
      }
      const resolved = await resolveAddress(info.value, address.mode, address.segments, options)
      if (!resolved.ok) {
        await taken.settle({ problem: resolved.problem })
        return resolved.problem === 'ref-not-found' ? fail(404, 'ref_not_found') : githubFailure(resolved)
      }
      const { ref, refKind, commit, path } = resolved.value
      const added = await addRepo(db, userId, { ...info.value, ref, refKind, commitSha: commit })
      if (added === 'quota') {
        await taken.settle({ problem: 'quota' })
        return fail(409, 'quota', { max: MAX_REPOS })
      }
      if ('exists' in added) {
        await taken.settle({ problem: 'exists', id: added.exists })
        return fail(409, 'exists', { id: added.exists })
      }
      await taken.settle({ id: added.id })
      return noStoreJson(201, { repo: toRepoView(added), path })
    },
  )

type Refreshed =
  | { ok: true; row: RepoRow; changed: boolean }
  | { ok: false; problem: 'limited' }
  | (Problem & { problem: 'busy' | 'unavailable' | 'too-large' | 'not-found' | 'empty' })

function refToResolve(row: RepoRow, defaultBranch: string): string {
  if (row.ref === null) return defaultBranch
  return row.refKind === 'branch' ? `heads/${row.ref}` : row.ref
}

const factsOf = ({ owner, name, defaultBranch, description }: RepoInfo | RepoRow) => ({
  owner,
  name,
  defaultBranch,
  description,
})

async function refreshRepo(
  db: Pool,
  request: Request,
  userId: number,
  row: RepoRow,
  options: GitHubOptions,
): Promise<Refreshed> {
  const taken = await take(db, userId, 'repo-refresh', { ip: requestIp(request), detail: { id: row.id } })
  if (!taken.ok) return { ok: false, problem: 'limited' }
  const gone = async (): Promise<Refreshed> => {
    const marked = (await markGone(db, userId, row.id)) ?? row
    await taken.settle({ changed: false, gone: true })
    return { ok: true, row: marked, changed: false }
  }
  const failed = async (failure: Problem & Refreshed): Promise<Refreshed> => {
    await taken.settle({ problem: failure.problem })
    return failure
  }
  let facts = factsOf(row)
  if (row.ref === null) {
    const info = await getRepoById(row.githubId, options)
    if (!info.ok) return info.problem === 'not-found' ? gone() : failed(info)
    facts = factsOf(info.value)
  }
  const head = await resolveRef(facts.owner, facts.name, refToResolve(row, facts.defaultBranch), options)
  let commit: string
  if (head.ok) commit = head.value
  else if (head.problem === 'empty' && row.ref === null) commit = EMPTY_COMMIT
  else if (head.problem === 'not-found' || head.problem === 'empty') return gone()
  else return failed(head)
  const changed = commit !== row.commitSha
  const updated = (await markChecked(db, userId, row.id, { ...facts, commitSha: commit })) ?? row
  await taken.settle({ changed })
  return { ok: true, row: updated, changed }
}

export const handleRepoAction = (request: Request, id: string, options: GitHubOptions = {}) =>
  repos.post(
    request,
    { log: 'repo action', before: () => (isRepoId(id) ? undefined : notFound()), parse: parseRepoAction },
    async ({ session, db, input: intent }) => {
      const { userId } = session
      if (intent === 'remove') {
        if (!(await removeRepo(db, userId, id))) return notFound()
        await recordEvent(db, 'repo.removed', { userId, ip: requestIp(request), detail: { id } })
        return noStoreJson(200, { removed: true })
      }
      const row = await findRepo(db, userId, id)
      if (!row) return notFound()
      const refreshed = await refreshRepo(db, request, userId, row, options)
      if (!refreshed.ok) return refreshed.problem === 'limited' ? fail(429, 'limited') : githubFailure(refreshed)
      return noStoreJson(200, { repo: toRepoView(refreshed.row), changed: refreshed.changed })
    },
  )

const PICTURE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'private, no-store',
} as const

const pictureText = (status: number, text: string) =>
  new Response(text, { status, headers: { 'content-type': 'text/plain', ...PICTURE_HEADERS } })

export function sniffPicture(bytes: Uint8Array): string | null {
  const sniffed = sniffImage(bytes)
  if (sniffed) return sniffed.type
  const ascii = (at: number, text: string) => [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0))
  if (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return 'image/avif'
  if (ascii(0, 'BM') && bytes.length > 26) return 'image/bmp'
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0 && bytes.length > 22) return 'image/x-icon'
  if (isSvg(bytes)) return 'image/svg+xml'
  return null
}

export const treeKey = (row: RepoRow): TreeKey => ({
  githubId: row.githubId,
  owner: row.owner,
  name: row.name,
  commit: row.commitSha,
})

export async function handleRepoRaw(request: Request, id: string, options: GitHubOptions = {}): Promise<Response> {
  const missing = () => pictureText(404, 'Not found')
  if (!isRepoId(id) || !isDatabaseConfigured()) return missing()
  const path = parsePath(new URL(request.url).searchParams.get('path'))
  if (!path) return missing()
  try {
    const session = await sessionForRequest(request)
    if (!session) return missing()
    const row = await findRepo(getDb(), session.userId, id)
    if (!row || row.commitSha === EMPTY_COMMIT) return missing()
    if (takeView(session.userId)) return pictureText(429, 'Too many requests')
    const tree = await loadTree(treeKey(row), options)
    if (!tree.ok) return tree.problem === 'not-found' ? missing() : pictureText(503, 'Unavailable')
    await loadFolder(treeKey(row), tree.value, parentOf(path), options)
    const entry = tree.value.byPath.get(path)
    if (entry?.type !== 'blob' || entry.mode === LINK_MODE || (entry.size ?? 0) > PICTURE_MAX_BYTES) return missing()
    const bytes = await getRaw(row.owner, row.name, row.commitSha, path, PICTURE_MAX_BYTES, options)
    if (!bytes.ok) return bytes.problem === 'not-found' ? missing() : pictureText(503, 'Unavailable')
    const type = sniffPicture(bytes.value)
    if (!type) return missing()
    return new Response(new Uint8Array(bytes.value), {
      headers: { 'content-type': type, 'content-length': String(bytes.value.length), ...PICTURE_HEADERS },
    })
  } catch (error) {
    logError('repo raw', error)
    return pictureText(503, 'Unavailable')
  }
}

export const reposState = (request: Request): Promise<ReposState> =>
  signedInRead(request, 'repos', async ({ session, db }) => ({
    state: 'ready',
    repos: (await listRepos(db, session.userId)).map(toRepoView),
  }))

type Opened = { ok: true; row: RepoRow } | { ok: false; state: RepoReadProblem }

async function openRepo(db: Db, userId: number, id: string): Promise<Opened> {
  if (!isRepoId(id)) return { ok: false, state: { state: 'not_found' } }
  const row = await findRepo(db, userId, id)
  if (!row) return { ok: false, state: { state: 'not_found' } }
  if (takeView(userId)) return { ok: false, state: { state: 'limited' } }
  return { ok: true, row }
}

async function targetOf(
  row: RepoRow,
  tree: RenderTarget['tree'],
  path: string,
  view: 'preview' | 'code',
  options: GitHubOptions,
): Promise<GitHubResult<RepoTarget>> {
  const target: RenderTarget = { owner: row.owner, name: row.name, commit: row.commitSha, tree }
  const fetchRaw: RawFetch = (rawPath, maxBytes) =>
    getRaw(row.owner, row.name, row.commitSha, rawPath, maxBytes, options)
  const folder = await loadFolder(treeKey(row), tree, path, options)
  if (!folder.ok && folder.problem !== 'missing') return folder
  const entries = folder.ok ? childrenOf(tree, path) : null
  if (entries) {
    const rendered = await renderFolder(path, entries, target, fetchRaw)
    return rendered.ok ? { ok: true, value: { kind: 'folder', folder: rendered.value } } : (rendered as Problem)
  }
  const entry = tree.byPath.get(path)
  if (!entry || entry.type === 'tree') return { ok: true, value: { kind: 'missing' } }
  const file = await renderFile(entry, isPictureName(entry.path) ? 'preview' : view, target, fetchRaw)
  if (!file.ok) return file.problem === 'not-found' ? { ok: true, value: { kind: 'missing' } } : (file as Problem)
  return { ok: true, value: { kind: 'file', file: file.value } }
}

/** The root and each folder down to `path` (or to its folder when it isn't one), top first, until one fails to load. */
async function foldersAlong(
  row: RepoRow,
  tree: RenderTarget['tree'],
  path: string,
  isFolder: boolean,
  options: GitHubOptions,
): Promise<{ path: string; entries: RepoEntry[] }[]> {
  const parts = path ? path.split('/') : []
  const depth = isFolder ? parts.length : parts.length - 1
  const folders: { path: string; entries: RepoEntry[] }[] = []
  for (let i = 0; i <= Math.max(0, depth); i++) {
    const folder = parts.slice(0, i).join('/')
    const loaded = await loadFolder(treeKey(row), tree, folder, options)
    const entries = loaded.ok ? childrenOf(tree, folder) : null
    if (!entries) break
    folders.push({ path: folder, entries })
  }
  return folders
}

export function repoViewState(
  request: Request,
  id: string,
  rawPath: string,
  view: 'preview' | 'code',
  options: GitHubOptions = {},
): Promise<RepoViewState> {
  return signedInRead(request, 'repo view', async ({ session, db }): Promise<RepoViewState> => {
    const opened = await openRepo(db, session.userId, id)
    if (!opened.ok) return opened.state
    let { row } = opened
    await markOpened(db, session.userId, row.id)
    let refreshed: { changed: boolean } | null = null
    if (Date.now() - row.checkedAt.getTime() > STALE_MS) {
      const result = await refreshRepo(db, request, session.userId, row, options)
      if (result.ok) {
        row = result.row
        refreshed = { changed: result.changed }
      }
    }
    const repo = toRepoView(row)
    const path = parsePath(rawPath)
    if (path === null) return { state: 'not_found' }
    if (row.commitSha === EMPTY_COMMIT)
      return { state: 'ready', repo, folders: [], target: { kind: 'empty' }, refreshed }
    const tree = await loadTree(treeKey(row), options)
    if (!tree.ok) {
      if (tree.problem === 'not-found' && row.goneAt)
        return { state: 'ready', repo, folders: [], target: { kind: 'gone' }, refreshed }
      return readProblem(tree)
    }
    const target = await targetOf(row, tree.value, path, view, options)
    if (!target.ok) return readProblem(target)
    const folders = await foldersAlong(row, tree.value, path, target.value.kind === 'folder', options)
    return { state: 'ready', repo, folders, target: target.value, refreshed }
  })
}

export function repoFolderState(
  request: Request,
  id: string,
  rawPath: string,
  options: GitHubOptions = {},
): Promise<RepoFolderState> {
  return signedInRead(request, 'repo folder', async ({ session, db }): Promise<RepoFolderState> => {
    const path = parsePath(rawPath)
    const opened = await openRepo(db, session.userId, id)
    if (!opened.ok) return opened.state
    if (path === null || opened.row.commitSha === EMPTY_COMMIT) return { state: 'not_found' }
    const tree = await loadTree(treeKey(opened.row), options)
    if (!tree.ok) return tree.problem === 'not-found' ? { state: 'not_found' } : readProblem(tree)
    const loaded = await loadFolder(treeKey(opened.row), tree.value, path, options)
    if (!loaded.ok) return loaded.problem === 'missing' ? { state: 'not_found' } : readProblem(loaded)
    const entries = childrenOf(tree.value, path)
    return entries ? { state: 'ready', entries } : { state: 'not_found' }
  })
}
