import { MAX_REPO_URL_LENGTH, type RepoUrlProblem } from './contract.ts'

export const RESERVED_OWNERS: ReadonlySet<string> = new Set([
  'about',
  'apps',
  'codespaces',
  'collections',
  'contact',
  'customer-stories',
  'dashboard',
  'enterprise',
  'events',
  'explore',
  'features',
  'github-copilot',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'readme',
  'search',
  'security',
  'settings',
  'signup',
  'site',
  'sponsors',
  'stars',
  'team',
  'topics',
  'trending',
  'users',
])

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
const NAME = /^[A-Za-z0-9._-]{1,100}$/
const HOSTS = new Set(['github.com', 'www.github.com'])
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

export type ParsedRepoUrl =
  | {
      ok: true
      owner: string
      name: string
      mode: 'tree' | 'blob' | null
      segments: string[]
    }
  | { ok: false; reason: RepoUrlProblem }

const refuse = (reason: RepoUrlProblem): ParsedRepoUrl => ({ ok: false, reason })

export const isOwner = (owner: string) => OWNER.test(owner) && !RESERVED_OWNERS.has(owner.toLowerCase())
export const isRepoName = (name: string) => NAME.test(name) && name !== '.' && name !== '..'

export function parseRepoUrl(input: string): ParsedRepoUrl {
  const text = input.trim()
  if (!text) return refuse('empty')
  if (text.length > MAX_REPO_URL_LENGTH) return refuse('too_long')
  const withScheme = SCHEME.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return refuse('not_url')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return refuse('not_url')
  if (!HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) return refuse('not_github')
  const segments: string[] = []
  for (const raw of url.pathname.split('/')) {
    if (!raw) continue
    try {
      segments.push(decodeURIComponent(raw))
    } catch {
      return refuse('not_url')
    }
  }
  const [owner, rawName, kind, ...rest] = segments
  if (!owner || !rawName || !isOwner(owner)) return refuse('not_repository')
  const name = rawName.toLowerCase().endsWith('.git') ? rawName.slice(0, -4) : rawName
  if (!isRepoName(name)) return refuse('not_repository')
  if (kind === undefined) return { ok: true, owner, name, mode: null, segments: [] }
  if (kind === 'tree' && rest.length >= 1) return { ok: true, owner, name, mode: 'tree', segments: rest }
  if (kind === 'blob' && rest.length >= 2) return { ok: true, owner, name, mode: 'blob', segments: rest }
  return refuse('not_repository')
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export function githubBlobUrl(
  owner: string,
  name: string,
  commit: string,
  path: string,
  kind: 'tree' | 'blob',
): string {
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${kind}/${commit}`
  return path ? `${base}/${encodePath(path)}` : base
}
