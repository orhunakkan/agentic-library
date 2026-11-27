import { isPrivateBookSlug, privateBookSlug } from '~/shared/content/book-slug'
import { refreshAppCache } from './app-cache'
import { sweepRepoOrphans } from './repo-store'
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
