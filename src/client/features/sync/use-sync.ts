import { useEffect } from 'react'
import { browserStorage } from '~/client/features/ask/thread-store'
import { getSyncState } from '~/server/account-functions'
import { createSync, type Sync } from './engine'
import { syncOutbox } from './outbox'
import { readState } from './sync-client'

const STALE_MS = 60_000

let app: Sync | null = null

function appSync(): Sync {
  app ??= createSync({
    storage: browserStorage(),
    read: () => readState(() => getSyncState()),
    outbox: syncOutbox,
    now: () => Date.now(),
    siteDark: () => document.documentElement.classList.contains('dark'),
  })
  return app
}

export function useSync(username: string | null): void {
  useEffect(() => {
    const sync = appSync()
    if (username === null || document.documentElement.dataset.embed === 'on') {
      sync.stop()
      return
    }
    void sync.start(username)
    let hiddenAt: number | null = null
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        void syncOutbox.flush({ keepalive: true })
        return
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= STALE_MS) void sync.pull()
      hiddenAt = null
    }
    const onFocus = () => void sync.pullIfStale(STALE_MS)
    const onPageHide = () => void syncOutbox.flush({ keepalive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [username])
}
