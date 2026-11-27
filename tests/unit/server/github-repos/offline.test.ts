import { beforeEach, describe, expect, it } from 'vitest'
import { buildTree, type RawFetch, type RenderTarget, resetRendered, VIEW_MAX_BYTES } from '~/server/github-repos/files'
import type { TreeEntry } from '~/server/github-repos/github-parse'
import { batchEntries, OFFLINE_RENDERS, planOffline, renderBatch } from '~/server/github-repos/offline'
import { MAX_OFFLINE_BYTES, MAX_OFFLINE_FILES } from '~/shared/github-repos/offline'

const SHA = 'a'.repeat(40)
const blob = (path: string, size = 10, mode = '100644'): TreeEntry => ({ path, mode, type: 'blob', sha: SHA, size })
const folder = (path: string): TreeEntry => ({ path, mode: '040000', type: 'tree', sha: SHA, size: null })
const submodule = (path: string): TreeEntry => ({ path, mode: '160000', type: 'commit', sha: SHA, size: null })
const treeOf = (entries: TreeEntry[], truncated = false) => buildTree({ sha: SHA, truncated, entries })

beforeEach(() => resetRendered())

describe('planOffline', () => {
  it('lists every folder with its entries and README, every file, and the bytes it will fetch', () => {
    const tree = treeOf([
      blob('README.md', 100),
      folder('docs'),
      blob('docs/guide.md', 50),
      blob('docs/readme.markdown', 20),
      folder('docs/empty'),
      blob('logo.png', 4000),
      blob('latest', 13, '120000'),
      submodule('vendor/lib'),
      folder('vendor'),
      blob('assets/huge.bin', VIEW_MAX_BYTES + 1),
      folder('assets'),
    ])
    const planned = planOffline(tree)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const { folders, files, bytes } = planned.plan
    expect(folders.map((f) => [f.path, f.readme])).toEqual([
      ['', 'README.md'],
      ['assets', null],
      ['docs', 'docs/readme.markdown'],
      ['docs/empty', null],
      ['vendor', null],
    ])
    expect(folders[0]?.entries.map((e) => e.name)).toEqual([
      'assets',
      'docs',
      'vendor',
      'latest',
      'logo.png',
      'README.md',
    ])
    expect(folders[3]?.entries).toEqual([])
    /** Folder by folder, so the first batches hold the root and its README. */
    expect(files).toEqual([
      'latest',
      'logo.png',
      'README.md',
      'assets/huge.bin',
      'docs/guide.md',
      'docs/readme.markdown',
      'vendor/lib',
    ])
    /** The README, both docs and the link: the picture, the submodule and the file too large to show fetch nothing. */
    expect(bytes).toBe(100 + 50 + 20 + 13)
  })

  it('is too large past 2,000 files, counting every entry that isn’t a folder', () => {
    const many = (count: number) => Array.from({ length: count }, (_, i) => blob(`f${i}.txt`, 1))
    expect(planOffline(treeOf(many(MAX_OFFLINE_FILES))).ok).toBe(true)
    expect(planOffline(treeOf(many(MAX_OFFLINE_FILES + 1)))).toEqual({
      ok: false,
      tooLarge: {
        files: MAX_OFFLINE_FILES + 1,
        bytes: MAX_OFFLINE_FILES + 1,
        maxFiles: 2000,
        maxBytes: 20 * 1024 * 1024,
      },
    })
  })

  it('is too large past 20 MB to fetch', () => {
    const near = Array.from({ length: 20 }, (_, i) => blob(`part${i}.txt`, VIEW_MAX_BYTES))
    expect(planOffline(treeOf(near)).ok).toBe(true)
    const over = treeOf([...near, blob('one-more.txt', 1)])
    expect(planOffline(over)).toEqual({
      ok: false,
      tooLarge: { files: 21, bytes: MAX_OFFLINE_BYTES + 1, maxFiles: MAX_OFFLINE_FILES, maxBytes: MAX_OFFLINE_BYTES },
    })
  })

  it('is too large, with no numbers, when GitHub sent only part of the tree', () => {
    expect(planOffline(treeOf([blob('README.md')], true))).toEqual({
      ok: false,
      tooLarge: { files: null, bytes: null, maxFiles: MAX_OFFLINE_FILES, maxBytes: MAX_OFFLINE_BYTES },
    })
    expect(planOffline(buildTree({ sha: SHA, truncated: false, entries: [blob('README.md')] }, true)).ok).toBe(false)
  })
})

describe('batchEntries', () => {
  const tree = treeOf([blob('README.md'), folder('docs'), blob('docs/a.md'), submodule('vendor')])

  it('the entries for the paths, in their order', () => {
    expect(batchEntries(tree, ['docs/a.md', 'README.md', 'vendor'])?.map((e) => e.path)).toEqual([
      'docs/a.md',
      'README.md',
      'vendor',
    ])
  })

  it('null when a path is a folder or isn’t in the tree', () => {
    expect(batchEntries(tree, ['README.md', 'docs'])).toBeNull()
    expect(batchEntries(tree, ['README.md', 'nowhere.md'])).toBeNull()
    expect(batchEntries(tree, [''])).toBeNull()
  })
})

describe('renderBatch', () => {
  const entries = Array.from({ length: 7 }, (_, i) => blob(`f${i}.ts`))
  const tree = treeOf(entries)
  const target: RenderTarget = { owner: 'o', name: 'r', commit: SHA, tree }

  it('renders each file as the preview page does, at most two at a time, in order', async () => {
    let inFlight = 0
    let most = 0
    const fetchRaw: RawFetch = async (path) => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return { ok: true, value: new TextEncoder().encode(`export const name = '${path}'\n`) }
    }
    const rendered = await renderBatch(
      entries.map((e, i) => ({ ...e, sha: String(i).repeat(40) })),
      target,
      fetchRaw,
    )
    expect(OFFLINE_RENDERS).toBe(2)
    expect(most).toBe(2)
    expect(rendered.ok && rendered.value.map((f) => [f.path, f.content.kind, f.lines])).toEqual(
      entries.map((e) => [e.path, 'code', 1]),
    )
  })

  it('stops at the first problem and answers it', async () => {
    let asked = 0
    const fetchRaw: RawFetch = async (path) => {
      asked++
      return path === 'f1.ts'
        ? { ok: false, problem: 'busy', retryAt: new Date(0) }
        : { ok: true, value: new TextEncoder().encode('x') }
    }
    const rendered = await renderBatch(
      entries.map((e, i) => ({ ...e, sha: String(i).repeat(40) })),
      target,
      fetchRaw,
    )
    expect(rendered).toEqual({ ok: false, problem: 'busy', retryAt: new Date(0) })
    expect(asked).toBeLessThan(entries.length)
  })
})
