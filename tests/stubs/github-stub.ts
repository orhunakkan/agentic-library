import { createHash } from 'node:crypto'
import { FIXTURE_REPOS, type FixtureFile, type FixtureRepo } from './github/fixture.ts'

interface StubState {
  movingCommit: number
  movingGone: boolean
  requests: string[]
}

export const githubStubState: StubState = { movingCommit: 0, movingGone: false, requests: [] }

export function resetGitHubStub(): void {
  githubStubState.movingCommit = 0
  githubStubState.movingGone = false
  githubStubState.requests = []
}

const sha1 = (text: string | Uint8Array) => createHash('sha1').update(text).digest('hex')
const RESET_SECONDS = () => Math.floor(Date.now() / 1000) + 3600

const limitHeaders = (remaining: number) => ({
  'x-ratelimit-limit': '60',
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-reset': String(RESET_SECONDS()),
})

const api = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...limitHeaders(59), ...headers } })

const NOT_FOUND = () => api({ message: 'Not Found', status: '404' }, 404)

const isGone = (repo: FixtureRepo) => repo.name === 'moving' && githubStubState.movingGone

function findRepo(owner: string, name: string): FixtureRepo | { renamed: FixtureRepo } | null {
  for (const repo of FIXTURE_REPOS) {
    if (repo.owner.toLowerCase() !== owner.toLowerCase()) continue
    if (repo.name.toLowerCase() === name.toLowerCase()) return isGone(repo) ? null : repo
    if (repo.renamedFrom?.some((old) => old.toLowerCase() === name.toLowerCase())) return { renamed: repo }
  }
  return null
}

function repoJson(repo: FixtureRepo) {
  return {
    id: repo.id,
    name: repo.name,
    full_name: `${repo.owner}/${repo.name}`,
    private: repo.visibility === 'private',
    visibility: repo.visibility ?? 'public',
    default_branch: repo.defaultBranch,
    description: repo.description,
    owner: { login: repo.owner, id: repo.id * 10, type: 'Organization' },
  }
}

function commitFor(repo: FixtureRepo, ref: string): FixtureRepo['commits'][number] | null {
  const branchOnly = ref.startsWith('heads/')
  const name = branchOnly ? ref.slice('heads/'.length) : ref
  const branch = repo.refs[name]
  if (branch !== undefined)
    return repo.commits[repo.name === 'moving' && name === 'main' ? githubStubState.movingCommit : branch] ?? null
  if (branchOnly) return null
  const tag = repo.tags?.[name]
  if (tag !== undefined) return repo.commits[tag] ?? null
  return (/^[0-9a-f]{7,40}$/.test(name) && repo.commits.find((c) => c.sha.startsWith(name))) || null
}

interface Entry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

const bytesOf = (file: FixtureFile) =>
  typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content

function entriesOf(commitSha: string, files: Record<string, FixtureFile>): Entry[] {
  const entries = new Map<string, Entry>()
  for (const [path, file] of Object.entries(files)) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/')
      if (!entries.has(folder))
        entries.set(folder, { path: folder, mode: '040000', type: 'tree', sha: sha1(`tree ${commitSha} ${folder}`) })
    }
    if (file.submodule) {
      entries.set(path, { path, mode: '160000', type: 'commit', sha: sha1(`submodule ${path}`) })
      continue
    }
    const bytes = bytesOf(file)
    entries.set(path, {
      path,
      mode: file.mode ?? '100644',
      type: 'blob',
      sha: sha1(bytes ?? `size ${path}`),
      size: file.size ?? bytes?.length ?? 0,
    })
  }
  return [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function treeAnswer(repo: FixtureRepo, sha: string, recursive: boolean): Response {
  for (const commit of repo.commits) {
    const all = entriesOf(commit.sha, commit.files)
    const folder = sha === commit.sha ? '' : all.find((e) => e.type === 'tree' && e.sha === sha)?.path
    if (folder === undefined) continue
    const inside = all.filter((e) => (folder ? e.path.startsWith(`${folder}/`) : true))
    const relative = inside.map((e) => ({ ...e, path: folder ? e.path.slice(folder.length + 1) : e.path }))
    const direct = relative.filter((e) => !e.path.includes('/'))
    const truncated = recursive && !!repo.truncated
    const tree = !recursive ? direct : truncated ? relative.slice(0, 1) : relative
    return api({ sha, url: `https://api.github.com/repos/x/y/git/trees/${sha}`, truncated, tree })
  }
  return NOT_FOUND()
}

function apiAnswer(request: Request, path: string, url: URL, base: string): Response {
  const repoMatch = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path)
  const byId = /^\/repositories\/(\d+)(\/.*)?$/.exec(path)
  let repo: FixtureRepo | null = null
  let rest = ''
  if (repoMatch) {
    const found = findRepo(decodeURIComponent(repoMatch[1] ?? ''), decodeURIComponent(repoMatch[2] ?? ''))
    if (found && 'renamed' in found)
      return api({ message: 'Moved Permanently', url: `${base}/repositories/${found.renamed.id}` }, 301, {
        location: `${base}/repositories/${found.renamed.id}${repoMatch[3] ?? ''}`,
      })
    repo = found
    rest = repoMatch[3] ?? ''
  } else if (byId) {
    repo = FIXTURE_REPOS.find((r) => r.id === Number(byId[1]) && !isGone(r)) ?? null
    rest = byId[2] ?? ''
  }
  if (!repo) return NOT_FOUND()
  if (repo.rateLimited)
    return api(
      { message: 'API rate limit exceeded for 203.0.113.7.', documentation_url: 'https://docs.github.com/rest' },
      403,
      limitHeaders(0),
    )
  if (rest === '') return api(repoJson(repo))

  const commits = /^\/commits\/(.+)$/.exec(rest)
  if (commits) {
    if (request.headers.get('accept') !== 'application/vnd.github.sha') return api({ message: 'Wrong media type' }, 415)
    if (repo.empty) return api({ message: 'Git Repository is empty.', status: '409' }, 409)
    const ref = (commits[1] ?? '').split('/').map(decodeURIComponent).join('/')
    const commit = commitFor(repo, ref)
    if (!commit) return api({ message: `No commit found for SHA: ${ref}`, status: '422' }, 422)
    const etag = `"${commit.sha}"`
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers: { ...limitHeaders(59), etag } })
    return new Response(commit.sha, {
      headers: { ...limitHeaders(59), etag, 'content-type': 'application/vnd.github.sha; charset=utf-8' },
    })
  }
  const trees = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest)
  if (trees) return treeAnswer(repo, trees[1] ?? '', url.searchParams.get('recursive') === '1')
  return NOT_FOUND()
}

function rawAnswer(path: string): Response {
  const [owner, name, commitSha, ...segments] = path.slice(1).split('/').map(decodeURIComponent)
  const found = owner && name ? findRepo(owner, name) : null
  const repo = found && !('renamed' in found) ? found : null
  const commit = repo?.commits.find((c) => c.sha === commitSha)
  const file = commit?.files[segments.join('/')]
  const bytes = file ? bytesOf(file) : undefined
  if (!bytes) return new Response('404: Not Found', { status: 404 })
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' },
  })
}

function control(action: string): Response {
  if (action === 'advance') githubStubState.movingCommit = 1
  else if (action === 'reset') resetGitHubStub()
  else if (action === 'gone') githubStubState.movingGone = true
  else if (action === 'back') githubStubState.movingGone = false
  else return new Response('Unknown action', { status: 404 })
  return new Response(null, { status: 204 })
}

export async function githubStub(request: Request): Promise<Response> {
  const url = new URL(request.url)
  type Kind = 'api' | 'raw' | 'control' | 'requests'
  let kind: Kind
  let path = url.pathname
  let base = `${url.origin}`
  if (url.hostname === 'api.github.com') kind = 'api'
  else if (url.hostname === 'raw.githubusercontent.com') kind = 'raw'
  else {
    const match = /^(.*?\/test-github)\/(api|raw|control|requests)(\/.*)?$/.exec(url.pathname)
    if (!match) return new Response('Not found', { status: 404 })
    kind = match[2] as Kind
    path = match[3] ?? ''
    base = `${url.origin}${match[1]}/api`
  }
  if (kind === 'control')
    return request.method === 'POST' ? control(path.slice(1)) : new Response(null, { status: 405 })
  if (kind === 'requests') return Response.json(githubStubState.requests)
  if (!/^Folio \(/.test(request.headers.get('user-agent') ?? '')) return new Response('No User-Agent', { status: 400 })
  githubStubState.requests.push(`${kind}${path}`)
  return kind === 'api' ? apiAnswer(request, path, url, base) : rawAnswer(path)
}

export const githubStubFetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
  githubStub(new Request(input, init))) as typeof fetch
