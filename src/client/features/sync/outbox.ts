import { isTimeZone } from '~/shared/reading-stats/days'
import {
  isNewer,
  itemKey,
  type ListeningWrite,
  MAX_BATCH_ITEMS,
  type ReadingWrite,
  type SettingsWrite,
  type SyncBatch,
  type TimeWrite,
} from '~/shared/sync/sync'
import { type SendResult, sendBatch } from './sync-client'

export type OutboxItem = ReadingWrite | ListeningWrite | SettingsWrite | TimeWrite

type Group = 'reading' | 'listening' | 'settings' | 'time'

function groupOf(item: OutboxItem): Group {
  if ('values' in item) return 'settings'
  if ('seconds' in item) return 'time'
  if ('kind' in item) return 'listening'
  return 'reading'
}
const keyOf = (item: OutboxItem) => ('values' in item ? itemKey('settings') : itemKey(item))

const SEND_AFTER_MS: Record<Group, number> = {
  reading: 10_000,
  settings: 10_000,
  listening: 30_000,
  time: 60_000,
}
const GROUPS = Object.keys(SEND_AFTER_MS) as Group[]
const RETRY_MS = [10_000, 30_000, 60_000, 300_000] as const

export interface OutboxDeps {
  send: (batch: SyncBatch, options: { keepalive: boolean }) => Promise<SendResult>
  now: () => number
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (timer: unknown) => void
  zone: () => string | null
}

export interface Outbox {
  enable: (account: string | null) => void
  add: (item: OutboxItem) => void
  flush: (options?: { keepalive?: boolean }) => Promise<void>
  size: () => number
  timeSize: () => number
}

interface Held {
  group: Group
  item: OutboxItem
}

export function createOutbox(deps: OutboxDeps): Outbox {
  let account: string | null = null
  let epoch = 0
  const held = new Map<string, Held>()
  const first: Record<Group, number | null> = { reading: null, settings: null, listening: null, time: null }
  const clearFirst = () => {
    for (const group of GROUPS) first[group] = null
  }
  let failures = 0
  let retryAt: number | null = null
  let timer: unknown = null
  let running: Promise<void> = Promise.resolve()

  const cancelTimer = () => {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
  }

  const markWaiting = (group: Group) => {
    first[group] ??= deps.now()
  }

  const schedule = () => {
    cancelTimer()
    if (account === null || held.size === 0) return
    let at: number
    if (retryAt !== null) at = retryAt
    else {
      at = Math.min(
        ...GROUPS.map((group) => {
          const since = first[group]
          return since === null ? Number.POSITIVE_INFINITY : since + SEND_AFTER_MS[group]
        }),
      )
      if (!Number.isFinite(at)) return
    }
    timer = deps.setTimer(
      () => {
        timer = null
        void flush()
      },
      Math.max(0, at - deps.now()),
    )
  }

  const reset = () => {
    held.clear()
    clearFirst()
    failures = 0
    retryAt = null
    cancelTimer()
  }

  const enable = (next: string | null) => {
    if (next === account) return
    epoch++
    reset()
    account = next
  }

  const add = (item: OutboxItem) => {
    if (account === null) return
    const key = keyOf(item)
    const there = held.get(key)
    if (there && isNewer(there.item.at, item.at)) return
    const group = groupOf(item)
    held.set(key, { group, item })
    markWaiting(group)
    if (retryAt === null) schedule()
  }

  const batches = () => {
    const all = [...held.values()]
    const time = all.filter((h) => h.group === 'time')
    const reading = all.filter((h) => h.group === 'reading')
    const listening = all.filter((h) => h.group === 'listening')
    const settings = all.find((h) => h.group === 'settings')
    const out: { batch: SyncBatch; entries: Held[] }[] = []
    for (let i = 0; i === 0 || i < Math.max(reading.length, listening.length); i += MAX_BATCH_ITEMS) {
      const readingChunk = reading.slice(i, i + MAX_BATCH_ITEMS)
      const listeningChunk = listening.slice(i, i + MAX_BATCH_ITEMS)
      const heldSettings = i === 0 ? settings : undefined
      if (!readingChunk.length && !listeningChunk.length && !heldSettings) continue
      const batch: SyncBatch = {}
      if (readingChunk.length) batch.reading = readingChunk.map((h) => h.item as ReadingWrite)
      if (listeningChunk.length) batch.listening = listeningChunk.map((h) => h.item as ListeningWrite)
      if (heldSettings) batch.settings = heldSettings.item as SettingsWrite
      out.push({ batch, entries: [...readingChunk, ...listeningChunk, ...(heldSettings ? [heldSettings] : [])] })
    }
    for (let i = 0; i < time.length; i += MAX_BATCH_ITEMS) {
      const timeChunk = time.slice(i, i + MAX_BATCH_ITEMS)
      const zone = deps.zone()
      const batch: SyncBatch = { time: timeChunk.map((h) => h.item as TimeWrite) }
      if (zone !== null) batch.zone = zone
      out.push({ batch, entries: timeChunk })
    }
    return out
  }

  const forget = (entries: Held[]) => {
    for (const entry of entries) {
      const key = keyOf(entry.item)
      if (held.get(key) === entry) held.delete(key)
    }
  }

  const drain = async (keepalive: boolean) => {
    if (account === null || held.size === 0) return
    const mine = epoch
    cancelTimer()
    clearFirst()
    const out = batches()
    const sending = keepalive ? out.map(({ batch }) => deps.send(batch, { keepalive })) : null
    for (const [i, { batch, entries }] of out.entries()) {
      const result = await (sending?.[i] ?? deps.send(batch, { keepalive }))
      if (mine !== epoch) return
      if (result === 'signed_out') {
        enable(null)
        return
      }
      if (result === 'failed') {
        retryAt = deps.now() + (RETRY_MS[Math.min(failures, RETRY_MS.length - 1)] ?? 0)
        failures++
        schedule()
        return
      }
      forget(entries)
      failures = 0
      retryAt = null
    }
    for (const h of held.values()) markWaiting(h.group)
    schedule()
  }

  const flush = ({ keepalive = false }: { keepalive?: boolean } = {}) => {
    if (keepalive) {
      const leaving = drain(true)
      running = running.then(() => leaving)
      return leaving
    }
    running = running.then(() => drain(keepalive))
    return running
  }

  return {
    enable,
    add,
    flush,
    size: () => held.size,
    timeSize: () => [...held.values()].filter((h) => h.group === 'time').length,
  }
}

export function deviceZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return isTimeZone(zone) ? zone : null
}

let instance: Outbox | null = null

const app = (): Outbox => {
  instance ??= createOutbox({
    send: sendBatch,
    now: () => Date.now(),
    setTimer: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimer: (t) => globalThis.clearTimeout(t as ReturnType<typeof setTimeout>),
    zone: deviceZone,
  })
  return instance
}

export const syncOutbox: Outbox = {
  enable: (account) => app().enable(account),
  add: (item) => app().add(item),
  flush: (options) => app().flush(options),
  size: () => app().size(),
  timeSize: () => app().timeSize(),
}
