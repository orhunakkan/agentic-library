import { isPrivateBookSlug, privateBookSlug } from '~/shared/content/book-slug'
import { repoCheckKey } from '~/shared/offline/repo'
import { refreshAppCache } from './app-cache'
import { listRepoCopies, removeRepoCopy, sweepRepoOrphans } from './repo-store'
import {
  forgetPrivateDownloads,
  listDownloads,
  type OfflineEnv,
  offlineEnv,
  removeDownload,
  stampChecked,
  sweepOrphans,
} from './store'

export interface ReconcileDeps {
  refreshAppCache: typeof refreshAppCache
}

export async function reconcileDownloads(
  viewer: { username: string } | null,
  env: OfflineEnv = offlineEnv(),
  deps: ReconcileDeps = { refreshAppCache },
): Promise<void> {
  try {
    if (!env.caches) return
    if (!viewer) await forgetPrivateDownloads(env)
    else {
      const own: string[] = []
      for (const download of await listDownloads(env)) {
        if (!isPrivateBookSlug(download.slug)) continue
        if (download.owner === viewer.username) own.push(download.slug)
        else await removeDownload(download.slug, env)
      }
      for (const copy of await listRepoCopies(env)) {
        if (copy.account === viewer.username) own.push(repoCheckKey(copy.id))
        else await removeRepoCopy(copy.id, env)
      }
      stampChecked(own, env)
    }
    await sweepOrphans(env)
    await sweepRepoOrphans(env)
    await deps.refreshAppCache({}, env)
  } catch {}
}

export async function forgetGoneCopy(slug: string, env: OfflineEnv = offlineEnv()): Promise<void> {
  if (!isPrivateBookSlug(slug)) return
  await removeDownload(slug, env).catch(() => {})
}

export async function forgetUnlistedCopies(listedIds: readonly string[], env: OfflineEnv = offlineEnv()) {
  try {
    const listed = new Set(listedIds.map(privateBookSlug))
    for (const download of await listDownloads(env))
      if (isPrivateBookSlug(download.slug) && !listed.has(download.slug)) await removeDownload(download.slug, env)
  } catch {}
}

/** Deletes the copy of a repository the server says isn't this account's any more. */
export async function forgetGoneRepoCopy(id: string, env: OfflineEnv = offlineEnv()): Promise<void> {
  await removeRepoCopy(id, env).catch(() => {})
}

/** Deletes the copies of repositories the list no longer shows, as after removing one. */
export async function forgetUnlistedRepoCopies(listedIds: readonly string[], env: OfflineEnv = offlineEnv()) {
  try {
    const listed = new Set(listedIds)
    for (const copy of await listRepoCopies(env)) if (!listed.has(copy.id)) await removeRepoCopy(copy.id, env)
  } catch {}
}
