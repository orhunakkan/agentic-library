import '@tanstack/react-start/server-only'
import type {
  RepoEntry,
  RepoEntryKind,
  RepoFile,
  RepoFileContent,
  RepoFolder,
} from '../../shared/github-repos/contract.ts'
import type { RenderedMarkdown } from '../../shared/github-repos/md-node.ts'
import { MB } from '../../shared/import/limits.ts'
import type { ParsedTree, TreeEntry } from './github-parse.ts'
import { highlight, languageFor, withinHighlightCaps } from './highlight.ts'
import { renderMarkdown, resolvePath } from './markdown.ts'

export const VIEW_MAX_BYTES = 1 * MB
export const PICTURE_MAX_BYTES = 5 * MB
const BINARY_SNIFF_BYTES = 8000
const LFS_POINTER = 'version https://git-lfs.github.com/spec/v1'
export const LINK_MODE = '120000'
const PICTURE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'])
const README = /^readme\.(md|markdown)$/i

export interface RepoTree {
  sha: string
  complete: boolean
  byPath: Map<string, TreeEntry>
  folders: Map<string, TreeEntry[]>
}

export const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
export const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function addEntries(tree: RepoTree, entries: readonly TreeEntry[]): void {
  for (const entry of entries) {
    tree.byPath.set(entry.path, entry)
    const parent = parentOf(entry.path)
    const list = tree.folders.get(parent)
    if (list) list.push(entry)
    else tree.folders.set(parent, [entry])
    if (entry.type === 'tree' && tree.complete && !tree.folders.has(entry.path)) tree.folders.set(entry.path, [])
  }
}

export function buildTree(parsed: ParsedTree, rootOnly = false): RepoTree {
  const complete = !parsed.truncated && !rootOnly
  const tree: RepoTree = { sha: parsed.sha, complete, byPath: new Map(), folders: new Map([['', []]]) }
  addEntries(tree, parsed.entries)
  return tree
}

export function addFolder(tree: RepoTree, folder: string, parsed: ParsedTree): void {
  tree.folders.set(folder, [])
  addEntries(
    tree,
    parsed.entries.map((e) => ({ ...e, path: folder ? `${folder}/${e.path}` : e.path })),
  )
}

export const treeBytes = (tree: RepoTree) => 200 + tree.byPath.size * 160

function entryKind(entry: TreeEntry): RepoEntryKind {
  if (entry.type === 'tree') return 'folder'
  if (entry.type === 'commit') return 'submodule'
  return entry.mode === LINK_MODE ? 'link' : 'file'
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function childrenOf(tree: RepoTree, folder: string): RepoEntry[] | null {
  const entries = tree.folders.get(folder)
  if (!entries) return null
  return entries
    .map((e): RepoEntry => ({ name: nameOf(e.path), path: e.path, kind: entryKind(e), size: e.size }))
    .sort((a, b) => {
      const folders = Number(b.kind === 'folder') - Number(a.kind === 'folder')
      if (folders) return folders
      return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    })
}

export function readmeOf(entries: readonly RepoEntry[]): RepoEntry | null {
  const files = entries.filter((e) => e.kind === 'file' && README.test(e.name))
  return files.find((e) => e.name.toLowerCase() === 'readme.md') ?? files[0] ?? null
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const isMarkdownName = (name: string) => {
  const extension = extensionOf(name)
  return extension === 'md' || extension === 'markdown'
}

export const isPictureName = (name: string) => PICTURE_EXTENSIONS.has(extensionOf(name))

export type EntryClass =
  | { kind: 'submodule' }
  | { kind: 'link' }
  | { kind: 'too-large'; size: number }
  | { kind: 'picture'; size: number }
  | { kind: 'fetch'; size: number }

export function classifyEntry(entry: TreeEntry): EntryClass {
  if (entry.type === 'commit') return { kind: 'submodule' }
  if (entry.mode === LINK_MODE) return { kind: 'link' }
  const size = entry.size ?? 0
  if (isPictureName(entry.path) && size <= PICTURE_MAX_BYTES) return { kind: 'picture', size }
  if (size > VIEW_MAX_BYTES) return { kind: 'too-large', size }
  return { kind: 'fetch', size }
}

export type ContentClass =
  | { kind: 'lfs' }
  | { kind: 'binary' }
  | { kind: 'markdown'; text: string }
  | { kind: 'code'; text: string }

const utf8 = new TextDecoder('utf-8', { fatal: true })

export function classifyContent(bytes: Uint8Array, name: string): ContentClass {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, LFS_POINTER.length))
  if (head === LFS_POINTER) return { kind: 'lfs' }
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { kind: 'binary' }
  let text: string
  try {
    text = utf8.decode(bytes)
  } catch {
    return { kind: 'binary' }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return isMarkdownName(name) ? { kind: 'markdown', text } : { kind: 'code', text }
}

export function lineCount(text: string): number {
  if (!text) return 0
  let lines = 1
  for (let i = text.indexOf('\n'); i !== -1 && i < text.length - 1; i = text.indexOf('\n', i + 1)) lines++
  return lines
}

export type RawFetch = (
  path: string,
  maxBytes: number,
) => Promise<{ ok: true; value: Uint8Array } | { ok: false; problem: string; retryAt?: Date }>

export interface RenderTarget {
  owner: string
  name: string
  commit: string
  tree: RepoTree
}

const RENDER_CACHE_MAX_BYTES = 64 * MB
let renderCacheMax = RENDER_CACHE_MAX_BYTES
const rendered = new Map<string, { size: number; value: RepoFile }>()
let renderedBytes = 0

export function resetRendered(maxBytes = RENDER_CACHE_MAX_BYTES): void {
  rendered.clear()
  renderedBytes = 0
  renderCacheMax = maxBytes
}

function remember(key: string, value: RepoFile): void {
  const size = JSON.stringify(value).length
  if (size > renderCacheMax / 4) return
  const old = rendered.get(key)
  if (old) {
    rendered.delete(key)
    renderedBytes -= old.size
  }
  rendered.set(key, { size, value })
  renderedBytes += size
  while (renderedBytes > renderCacheMax) {
    const [oldest, entry] = rendered.entries().next().value as [string, { size: number }]
    rendered.delete(oldest)
    renderedBytes -= entry.size
  }
}

function recall(key: string): RepoFile | undefined {
  const hit = rendered.get(key)
  if (!hit) return undefined
  rendered.delete(key)
  rendered.set(key, hit)
  return hit.value
}

export const kindOfIn = (tree: RepoTree) => (path: string) => {
  const entry = tree.byPath.get(path)
  if (entry) return entry.type === 'tree' ? 'folder' : 'file'
  return path === '' ? 'folder' : null
}

function renderMarkdownFor(text: string, path: string, target: RenderTarget): Promise<RenderedMarkdown> {
  return renderMarkdown(text, {
    owner: target.owner,
    name: target.name,
    folder: parentOf(path),
    kindOf: kindOfIn(target.tree),
  })
}

export type RenderProblem = { ok: false; problem: string; retryAt?: Date }

export async function renderFile(
  entry: TreeEntry,
  view: 'preview' | 'code',
  target: RenderTarget,
  fetchRaw: RawFetch,
): Promise<{ ok: true; value: RepoFile } | RenderProblem> {
  const name = nameOf(entry.path)
  const base = { path: entry.path, name, size: entry.size ?? 0 }
  const notice = (content: RepoFileContent): { ok: true; value: RepoFile } => ({
    ok: true,
    value: { ...base, lines: null, content },
  })
  const kind = classifyEntry(entry)
  if (kind.kind === 'submodule') return notice({ kind: 'notice', notice: 'submodule' })
  if (kind.kind === 'too-large') return notice({ kind: 'notice', notice: 'too-large', size: kind.size })
  if (kind.kind === 'picture') return notice({ kind: 'picture' })

  const markdownPreview = view === 'preview' && isMarkdownName(name)
  const key = markdownPreview
    ? `md:${target.owner.toLowerCase()}/${target.name.toLowerCase()}@${target.commit}:${entry.path}`
    : `${kind.kind}:${entry.sha}:${view}:${name}`
  const hit = recall(key)
  if (hit) return { ok: true, value: { ...hit, path: entry.path, name } }

  const bytes = await fetchRaw(entry.path, VIEW_MAX_BYTES)
  if (!bytes.ok) return bytes
  const file = await fileFromBytes(entry, kind.kind, bytes.value, view, target)
  remember(key, file)
  return { ok: true, value: file }
}

async function fileFromBytes(
  entry: TreeEntry,
  kind: 'link' | 'fetch',
  bytes: Uint8Array,
  view: 'preview' | 'code',
  target: RenderTarget,
): Promise<RepoFile> {
  const name = nameOf(entry.path)
  const base = { path: entry.path, name, size: entry.size ?? 0 }
  if (kind === 'link') {
    const link = new TextDecoder('utf-8').decode(bytes).trim()
    const resolved = resolveLink(entry.path, link)
    const targetPath = resolved !== null && target.tree.byPath.has(resolved) ? resolved : null
    return { ...base, lines: null, content: { kind: 'notice', notice: 'link', target: link, targetPath } }
  }
  const content = classifyContent(bytes, name)
  if (content.kind === 'lfs') return { ...base, lines: null, content: { kind: 'notice', notice: 'lfs' } }
  if (content.kind === 'binary')
    return { ...base, lines: null, content: { kind: 'notice', notice: 'binary', size: bytes.length } }
  const lines = lineCount(content.text)
  if (content.kind === 'markdown' && view === 'preview') {
    const markdown = await renderMarkdownFor(content.text, entry.path, target)
    return { ...base, lines, content: { kind: 'markdown', view: 'preview', markdown } }
  }
  const lang = content.kind === 'markdown' ? 'markdown' : languageFor(name)
  const code = await highlight(content.text, lang)
  const capped = lang !== null && !withinHighlightCaps(content.text)
  return {
    ...base,
    lines,
    content:
      content.kind === 'markdown' ? { kind: 'markdown', view: 'code', code, capped } : { kind: 'code', code, capped },
  }
}

export function resolveLink(linkPath: string, target: string): string | null {
  if (target.startsWith('/')) return null
  return resolvePath(parentOf(linkPath), target) || null
}

export async function renderFolder(
  folder: string,
  entries: RepoEntry[],
  target: RenderTarget,
  fetchRaw: RawFetch,
): Promise<{ ok: true; value: RepoFolder } | RenderProblem> {
  const readme = readmeOf(entries)
  const entry = readme ? target.tree.byPath.get(readme.path) : undefined
  if (!entry) return { ok: true, value: { path: folder, entries, readme: null } }
  const file = await renderFile(entry, 'preview', target, fetchRaw)
  if (!file.ok) return file
  const content = file.value.content
  return {
    ok: true,
    value: {
      path: folder,
      entries,
      readme:
        content.kind === 'markdown' && content.view === 'preview'
          ? { path: entry.path, markdown: content.markdown }
          : null,
    },
  }
}
