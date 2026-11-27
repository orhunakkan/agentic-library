import type { RepoFolder, RepoTarget, RepoViewState } from '~/shared/github-repos/contract'
import type { RepoCopy } from '~/shared/offline/repo'
import { readRepoCopy, readRepoFile } from './repo-store'
import { type OfflineEnv, offlineEnv } from './store'

export class RepoOfflineMissing extends Error {
  name = 'RepoOfflineMissing'
  constructor(readonly id: string) {
    super(`Repository ${id} is not downloaded on this device`)
  }
}

export const isRepoOfflineMissing = (error: unknown): error is RepoOfflineMissing =>
  error instanceof Error && error.name === 'RepoOfflineMissing'

export type OfflineRepoView = Extract<RepoViewState, { state: 'ready' }> & { offline: true }

async function folderOf(copy: RepoCopy, path: string, env: OfflineEnv): Promise<RepoFolder | null> {
  const folder = copy.folders.find((f) => f.path === path)
  if (!folder) return null
  const file = folder.readme === null ? null : await readRepoFile(copy, folder.readme, env)
  const content = file?.content
  const readme =
    file && content?.kind === 'markdown' && content.view === 'preview'
      ? { path: file.path, markdown: content.markdown }
      : null
  return { path, entries: folder.entries, readme }
}

async function targetOf(copy: RepoCopy, path: string, env: OfflineEnv): Promise<RepoTarget> {
  const folder = await folderOf(copy, path, env)
  if (folder) return { kind: 'folder', folder }
  const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')))
  const entry = copy.folders.find((f) => f.path === parent)?.entries.find((e) => e.path === path)
  if (!entry || entry.kind === 'folder') return { kind: 'missing' }
  const file = await readRepoFile(copy, path, env)
  return file ? { kind: 'file', file } : { kind: 'missing' }
}

/**
 * The repository page for `path`, put together from this device's copy, as the server would answer it online: every
 * folder, so the tree never asks for one, and the folder or file at `path`, or `missing` when the copy hasn't it.
 */
export async function repoViewFromCopy(
  id: string,
  path: string,
  env: OfflineEnv = offlineEnv(),
): Promise<OfflineRepoView> {
  const copy = await readRepoCopy(id, env)
  if (!copy) throw new RepoOfflineMissing(id)
  return {
    state: 'ready',
    repo: copy.repo,
    folders: copy.folders.map((f) => ({ path: f.path, entries: f.entries })),
    target: await targetOf(copy, path, env),
    refreshed: null,
    offline: true,
  }
}
