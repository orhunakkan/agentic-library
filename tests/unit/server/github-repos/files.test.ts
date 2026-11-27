import { beforeEach, describe, expect, it } from 'vitest'
import {
  addFolder,
  buildTree,
  childrenOf,
  classifyContent,
  classifyEntry,
  kindOfIn,
  lineCount,
  type RawFetch,
  readmeOf,
  renderFile,
  renderFolder,
  resetRendered,
  resolveLink,
  treeBytes,
  VIEW_MAX_BYTES,
} from '~/server/github-repos/files.ts'
import type { TreeEntry } from '~/server/github-repos/github-parse.ts'

const SHA = 'a'.repeat(40)
const blob = (path: string, size = 10, mode = '100644'): TreeEntry => ({ path, mode, type: 'blob', sha: SHA, size })
const folder = (path: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha: SHA, size: null })
const bytes = (text: string) => new TextEncoder().encode(text)

describe('classifyEntry', () => {
  it('a submodule, a link, a picture, too large, or bytes to fetch', () => {
    expect(classifyEntry({ path: 'vendor/lib', mode: '160000', type: 'commit', sha: SHA, size: null })).toEqual({
      kind: 'submodule',
    })
    expect(classifyEntry(blob('docs/latest', 6, '120000'))).toEqual({ kind: 'link' })
    expect(classifyEntry(blob('logo.PNG', 2 * 1024 * 1024))).toEqual({ kind: 'picture', size: 2 * 1024 * 1024 })
    expect(classifyEntry(blob('huge.png', 6 * 1024 * 1024))).toEqual({ kind: 'too-large', size: 6 * 1024 * 1024 })
    expect(classifyEntry(blob('a.ts', VIEW_MAX_BYTES))).toEqual({ kind: 'fetch', size: VIEW_MAX_BYTES })
    expect(classifyEntry(blob('a.ts', VIEW_MAX_BYTES + 1))).toEqual({ kind: 'too-large', size: VIEW_MAX_BYTES + 1 })
  })
})

describe('classifyContent', () => {
  it('an LFS pointer', () => {
    expect(classifyContent(bytes('version https://git-lfs.github.com/spec/v1\noid sha256:abc\n'), 'a.bin')).toEqual({
      kind: 'lfs',
    })
  })

  it('binary with a NUL byte inside the first 8,000 bytes, text with one after them', () => {
    const early = new Uint8Array(9000).fill(65)
    early[7999] = 0
    expect(classifyContent(early, 'a.txt')).toEqual({ kind: 'binary' })
    const late = new Uint8Array(9000).fill(65)
    late[8000] = 0
    expect(classifyContent(late, 'a.txt').kind).toBe('code')
  })

  it('binary when it is not valid UTF-8', () => {
    expect(classifyContent(new Uint8Array([0xc3, 0x28]), 'a.txt')).toEqual({ kind: 'binary' })
  })

  it('Markdown by its extension in any case, code otherwise, without a byte order mark', () => {
    expect(classifyContent(bytes('# Hi'), 'NOTES.MD')).toEqual({ kind: 'markdown', text: '# Hi' })
    expect(classifyContent(bytes('# Hi'), 'a.markdown').kind).toBe('markdown')
    expect(classifyContent(bytes('﻿x = 1'), 'a.py')).toEqual({ kind: 'code', text: 'x = 1' })
  })
})

describe('lineCount', () => {
  it('counts lines without a final newline', () => {
    expect(lineCount('')).toBe(0)
    expect(lineCount('a')).toBe(1)
    expect(lineCount('a\n')).toBe(1)
    expect(lineCount('a\nb\n\nc')).toBe(4)
  })
})

describe('trees', () => {
  const tree = buildTree({
    sha: SHA,
    truncated: false,
    entries: [
      folder('src'),
      blob('src/file10.ts'),
      blob('src/file2.ts'),
      blob('src/File1.ts'),
      folder('src/b'),
      folder('src/A'),
      blob('README.md'),
      blob('readme.markdown'),
      { path: 'lib', mode: '160000', type: 'commit', sha: SHA, size: null },
      blob('latest', 3, '120000'),
      folder('empty'),
    ],
  })

  it('childrenOf: folders first, then files, in natural order without case', () => {
    expect(childrenOf(tree, 'src')?.map((e) => e.name)).toEqual(['A', 'b', 'File1.ts', 'file2.ts', 'file10.ts'])
    expect(childrenOf(tree, '')?.map((e) => [e.name, e.kind])).toEqual([
      ['empty', 'folder'],
      ['src', 'folder'],
      ['latest', 'link'],
      ['lib', 'submodule'],
      ['readme.markdown', 'file'],
      ['README.md', 'file'],
    ])
    expect(childrenOf(tree, 'empty')).toEqual([])
    expect(childrenOf(tree, 'nope')).toBeNull()
    expect(treeBytes(tree)).toBeGreaterThan(0)
  })

  it('readmeOf picks README.md in any case', () => {
    expect(readmeOf(childrenOf(tree, '') ?? [])?.name).toBe('README.md')
    expect(readmeOf(childrenOf(tree, 'src') ?? [])).toBeNull()
  })

  it('a truncated tree loads its folders one at a time', () => {
    const partial = buildTree({ sha: SHA, truncated: true, entries: [folder('docs'), blob('a.md')] })
    expect(partial.complete).toBe(false)
    expect(childrenOf(partial, 'docs')).toBeNull()
    addFolder(partial, 'docs', { sha: SHA, truncated: false, entries: [blob('guide.md'), folder('img')] })
    expect(childrenOf(partial, 'docs')?.map((e) => e.path)).toEqual(['docs/img', 'docs/guide.md'])
    expect(partial.byPath.has('docs/guide.md')).toBe(true)
  })
})

describe('resolveLink', () => {
  it('reads a link against its folder', () => {
    expect(resolveLink('.opencode/skills', '../skills')).toBe('skills')
    expect(resolveLink('a/b', './c')).toBe('a/c')
    expect(resolveLink('a', '../../x')).toBeNull()
    expect(resolveLink('a', '/etc/passwd')).toBeNull()
    expect(resolveLink('a/b', '..')).toBeNull()
  })
})

describe('renderFile', () => {
  beforeEach(resetRendered)

  const tree = buildTree({
    sha: SHA,
    truncated: false,
    entries: [
      blob('README.md'),
      blob('src/index.ts', 20),
      blob('skills', 6, '120000'),
      folder('docs'),
      blob('docs/a.md'),
    ],
  })
  const target = { owner: 'o', name: 'r', commit: 'c'.repeat(40), tree }
  const fetchOf = (files: Record<string, string | Uint8Array>) => {
    const calls: string[] = []
    const fetchRaw: RawFetch = async (path) => {
      calls.push(path)
      const value = files[path]
      if (value === undefined) return { ok: false, problem: 'not-found' }
      return { ok: true, value: typeof value === 'string' ? bytes(value) : value }
    }
    return { calls, fetchRaw }
  }

  it('renders Markdown as a preview, or its source as code, and caches it', async () => {
    const { calls, fetchRaw } = fetchOf({ 'README.md': '# Title\n\n[a](docs/a.md)\n' })
    const entry = tree.byPath.get('README.md') as TreeEntry
    const preview = await renderFile(entry, 'preview', target, fetchRaw)
    expect(preview.ok && preview.value).toMatchObject({ lines: 3, content: { kind: 'markdown', view: 'preview' } })
    await renderFile(entry, 'preview', target, fetchRaw)
    expect(calls).toEqual(['README.md'])
    const code = await renderFile(entry, 'code', target, fetchRaw)
    expect(code.ok && code.value.content).toMatchObject({ kind: 'markdown', view: 'code', capped: false })
  })

  it('highlights code', async () => {
    const { fetchRaw } = fetchOf({ 'src/index.ts': 'export const a = 1\n' })
    const file = await renderFile(tree.byPath.get('src/index.ts') as TreeEntry, 'preview', target, fetchRaw)
    expect(file.ok && file.value.content).toMatchObject({ kind: 'code', code: { highlighted: true }, capped: false })
  })

  it('shows a link with its target, and binary and LFS files as notices', async () => {
    const { fetchRaw } = fetchOf({
      skills: 'docs',
      'src/index.ts': new Uint8Array([1, 0, 2]),
      'docs/a.md': 'version https://git-lfs.github.com/spec/v1\n',
    })
    const link = await renderFile(tree.byPath.get('skills') as TreeEntry, 'preview', target, fetchRaw)
    expect(link.ok && link.value.content).toEqual({
      kind: 'notice',
      notice: 'link',
      target: 'docs',
      targetPath: 'docs',
    })
    const binary = await renderFile(tree.byPath.get('src/index.ts') as TreeEntry, 'preview', target, fetchRaw)
    expect(binary.ok && binary.value.content).toEqual({ kind: 'notice', notice: 'binary', size: 3 })
    const lfs = await renderFile(tree.byPath.get('docs/a.md') as TreeEntry, 'preview', target, fetchRaw)
    expect(lfs.ok && lfs.value.content).toEqual({ kind: 'notice', notice: 'lfs' })
  })

  it('answers what the fetch answered when it fails', async () => {
    const { fetchRaw } = fetchOf({})
    expect(await renderFile(tree.byPath.get('README.md') as TreeEntry, 'preview', target, fetchRaw)).toEqual({
      ok: false,
      problem: 'not-found',
    })
  })

  it('renders a folder with its README, and without one', async () => {
    const { fetchRaw } = fetchOf({ 'README.md': '# Hi' })
    const root = await renderFolder('', childrenOf(tree, '') ?? [], target, fetchRaw)
    expect(root.ok && root.value.readme?.path).toBe('README.md')
    const docs = await renderFolder('docs', childrenOf(tree, 'docs') ?? [], target, fetchRaw)
    expect(docs.ok && docs.value.readme).toBeNull()
    expect(await renderFolder('', childrenOf(tree, '') ?? [], target, fetchOf({}).fetchRaw)).toMatchObject({
      ok: true,
    })
  })
})

describe('the rendered cache', () => {
  const names = ['a', 'b', 'c', 'd', 'e']
  const tree = buildTree({
    sha: SHA,
    truncated: false,
    entries: [...names.map((n) => ({ ...blob(`${n}.ts`, 10), sha: n.repeat(40) })), folder('docs')],
  })
  const target = { owner: 'o', name: 'r', commit: 'c'.repeat(40), tree }
  let fetched = 0
  const fetchRaw: RawFetch = async () => {
    fetched++
    return { ok: true, value: bytes('x'.repeat(200)) }
  }

  it('keeps one copy when two readers render the same file at once', async () => {
    resetRendered()
    fetched = 0
    const entry = tree.byPath.get('a.ts') as TreeEntry
    await Promise.all([renderFile(entry, 'preview', target, fetchRaw), renderFile(entry, 'preview', target, fetchRaw)])
    await renderFile(entry, 'preview', target, fetchRaw)
    expect(fetched).toBe(2)
  })

  it('forgets the least recently used past its size', async () => {
    resetRendered(1600)
    fetched = 0
    for (const n of names) await renderFile(tree.byPath.get(`${n}.ts`) as TreeEntry, 'preview', target, fetchRaw)
    await renderFile(tree.byPath.get('e.ts') as TreeEntry, 'preview', target, fetchRaw)
    expect(fetched).toBe(5)
    await renderFile(tree.byPath.get('a.ts') as TreeEntry, 'preview', target, fetchRaw)
    expect(fetched).toBe(6)
    resetRendered()
  })

  it('says what a path is, for the Markdown walker', () => {
    const kindOf = kindOfIn(tree)
    expect([kindOf('a.ts'), kindOf('docs'), kindOf(''), kindOf('nope')]).toEqual(['file', 'folder', 'folder', null])
  })
})
