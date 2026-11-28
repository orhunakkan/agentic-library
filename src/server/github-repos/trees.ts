import '@tanstack/react-start/server-only'
import { MB } from '../../shared/import/limits.ts'
import { addFolder, buildTree, type RepoTree, treeBytes } from './files.ts'
import { type GitHubOptions, type GitHubResult, getTree } from './github.ts'

const TREES_MAX_BYTES = 32 * MB
let treesMax = TREES_MAX_BYTES

const trees = new Map<string, RepoTree>()
let bytes = 0

export function resetTrees(maxBytes = TREES_MAX_BYTES): void {
  trees.clear()
  bytes = 0
  treesMax = maxBytes
}

export interface TreeKey {
  githubId: number
  owner: string
  name: string
  commit: string
}

const keyOf = (key: TreeKey) => `${key.githubId}@${key.commit}`

function account(key: string, tree: RepoTree, before: number): void {
  bytes += treeBytes(tree) - before
  trees.delete(key)
  trees.set(key, tree)
  while (bytes > treesMax && trees.size > 1) {
    const [oldest, old] = trees.entries().next().value as [string, RepoTree]
    trees.delete(oldest)
    bytes -= treeBytes(old)
  }
}

export async function loadTree(key: TreeKey, options: GitHubOptions = {}): Promise<GitHubResult<RepoTree>> {
  const id = keyOf(key)
  const hit = trees.get(id)
  if (hit) {
    trees.delete(id)
    trees.set(id, hit)
    return { ok: true, value: hit }
  }
  const whole = await getTree(key.owner, key.name, key.commit, { recursive: true }, options)
  if (!whole.ok && whole.problem !== 'too-large') return whole
  let tree: RepoTree
  /** A whole tree too large to read is opened as a truncated one is: its root now, each folder when it's opened. */
  if (!whole.ok || whole.value.truncated) {
    const root = await getTree(key.owner, key.name, key.commit, { recursive: false }, options)
    if (!root.ok) return root
    tree = buildTree(root.value, true)
  } else tree = buildTree(whole.value)
  account(id, tree, 0)
  return { ok: true, value: tree }
}

export async function loadFolder(
  key: TreeKey,
  tree: RepoTree,
  folder: string,
  options: GitHubOptions = {},
): Promise<GitHubResult<true> | { ok: false; problem: 'missing' }> {
  if (tree.folders.has(folder)) return { ok: true, value: true }
  const parts = folder.split('/')
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join('/')
    if (tree.folders.has(path)) continue
    const entry = tree.byPath.get(path)
    if (entry?.type !== 'tree') return { ok: false, problem: 'missing' }
    const before = treeBytes(tree)
    const fetched = await getTree(key.owner, key.name, entry.sha, { recursive: false }, options)
    if (!fetched.ok) return fetched
    addFolder(tree, path, fetched.value)
    account(keyOf(key), tree, before)
  }
  return { ok: true, value: true }
}
