import type { SyncState } from '~/shared/sync/sync'
import { readLocal, writeLocal } from './local'
import { merge, type SyncKind } from './merge'
import type { Outbox } from './outbox'

export type { SyncKind }

type Listener = (kinds: readonly SyncKind[]) => void

const listeners = new Set<Listener>()

export function onSynced(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(kinds: readonly SyncKind[]) {
  if (!kinds.length) return
  for (const listener of [...listeners]) listener(kinds)
}

export interface SyncDeps {
  storage: Storage | null
  read: () => Promise<SyncState>
  outbox: Outbox
  now: () => number
  siteDark: () => boolean
}

export interface Sync {
  start: (username: string) => Promise<void>
  stop: () => void
  pull: () => Promise<void>
  pullIfStale: (ms: number) => Promise<void>
}

export function createSync(deps: SyncDeps): Sync {
  let username: string | null = null
  let running: Promise<void> | null = null
  let again = false
  let lastRead = Number.NEGATIVE_INFINITY

  const stop = () => {
    username = null
    deps.outbox.enable(null)
  }

  const once = async () => {
    const name = username
    if (name === null) return
    const state = await deps.read()
    lastRead = deps.now()
    if (username !== name) return
    if (state.state === 'signed_out') return stop()
    if (state.state !== 'ready') return
    const result = merge(readLocal(deps.storage, deps.siteDark()), state, name)
    writeLocal(deps.storage, result.write, deps.siteDark())
    for (const item of result.push.reading ?? []) deps.outbox.add(item)
    for (const item of result.push.listening ?? []) deps.outbox.add(item)
    if (result.push.settings) deps.outbox.add(result.push.settings)
    emit(result.changed)
  }

  const pull = (): Promise<void> => {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await once()
      } while (again && username !== null)
    })().finally(() => {
      running = null
    })
    return running
  }

  return {
    start: (name) => {
      if (username !== name) {
        username = name
        deps.outbox.enable(name)
      }
      return pull()
    },
    stop,
    pull,
    pullIfStale: (ms) => (deps.now() - lastRead >= ms ? pull() : Promise.resolve()),
  }
}
