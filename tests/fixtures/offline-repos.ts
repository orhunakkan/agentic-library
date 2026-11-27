import type { RepoFile, RepoView } from '../../src/shared/github-repos/contract'
import type { RepoOfflineFolder, RepoOfflinePlan } from '../../src/shared/github-repos/offline'

export const REPO_ID = '7d4c1e2a-3b5f-4a6d-8e9f-0a1b2c3d4e5f'
export const OLD_COMMIT = '1'.repeat(40)
export const NEW_COMMIT = '2'.repeat(40)

export function repoView(patch: Partial<RepoView> = {}): RepoView {
  return {
    id: REPO_ID,
    owner: 'folio-test',
    name: 'sample',
    description: 'A fixture repository.',
    ref: null,
    refKind: 'default',
    defaultBranch: 'main',
    commit: OLD_COMMIT,
    addedAt: '2026-11-01T00:00:00.000Z',
    checkedAt: '2026-11-01T00:00:00.000Z',
    goneAt: null,
    ...patch,
  }
}

export const REPO_FOLDERS: RepoOfflineFolder[] = [
  {
    path: '',
    entries: [
      { name: 'docs', path: 'docs', kind: 'folder', size: null },
      { name: 'logo.png', path: 'logo.png', kind: 'file', size: 300 },
      { name: 'README.md', path: 'README.md', kind: 'file', size: 40 },
    ],
    readme: 'README.md',
  },
  { path: 'docs', entries: [{ name: 'guide.ts', path: 'docs/guide.ts', kind: 'file', size: 20 }], readme: null },
]

export const REPO_FILES = ['logo.png', 'README.md', 'docs/guide.ts']

const markdown = (text: string) => ({
  frontMatter: [],
  nodes: [{ t: 'el' as const, tag: 'p' as const, c: [{ t: 'text' as const, v: text }] }],
  externalImages: 0,
})

/** The file the server renders for `path`, with `version` in its text, so an old and a new copy tell apart. */
export function repoFile(path: string, version = 'old'): RepoFile {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (path.endsWith('.png')) return { path, name, size: 300, lines: null, content: { kind: 'picture' } }
  if (path.endsWith('.md'))
    return {
      path,
      name,
      size: 40,
      lines: 1,
      content: { kind: 'markdown', view: 'preview', markdown: markdown(version) },
    }
  return {
    path,
    name,
    size: 20,
    lines: 1,
    content: {
      kind: 'code',
      code: { palette: [['#000', '#fff']], lines: [[[`const v = '${version}'`, 0, 0]]], highlighted: true },
      capped: false,
    },
  }
}

export function repoPlan(patch: Partial<RepoOfflinePlan> = {}): RepoOfflinePlan {
  return { repo: repoView(), folders: REPO_FOLDERS, files: REPO_FILES, bytes: 360, ...patch }
}
