import { positionFromHref, type RecentReading } from '~/client/features/reader/continue-reading'
import {
  isNewer,
  itemKey,
  type ListeningPlace,
  type ListeningWrite,
  READ_LIMITS,
  type ReadingPlace,
  type ReadingWrite,
  type SyncBatch,
  type SyncedSettings,
  type SyncState,
} from '~/shared/sync/sync'
import type { LocalChanges, LocalListening, LocalState } from './local'

export type SyncKind = 'reading' | 'listening' | 'settings'

export interface MergeResult {
  write: LocalChanges
  push: SyncBatch
  replaced: boolean
  changed: SyncKind[]
}

type Ready = Extract<SyncState, { state: 'ready' }>

export const toEntry = (p: ReadingPlace): RecentReading => ({
  bookSlug: p.book,
  bookTitle: p.bookTitle,
  chapterTitle: p.chapterTitle,
  href: p.href,
  at: p.at,
  position: p.position,
  label: p.label,
  device: p.device,
})

const sameEntry = (a: RecentReading, b: RecentReading) =>
  a.href === b.href &&
  a.at === b.at &&
  a.bookTitle === b.bookTitle &&
  a.chapterTitle === b.chapterTitle &&
  a.label === b.label &&
  a.device === b.device

const floorOf = (ats: number[], limit: number) => (ats.length >= limit ? Math.min(...ats) : Number.NEGATIVE_INFINITY)

const listeningKey = (l: LocalListening | ListeningPlace) =>
  l.kind === 'episode' ? itemKey({ book: l.book, kind: 'episode', episode: l.episode }) : itemKey(l)

function sameListening(l: LocalListening, r: ListeningPlace): boolean {
  if (l.kind === 'episode') return r.kind === 'episode' && l.ms === r.positionMs
  if (r.kind !== 'voice') return false
  if (l.saved === null || r.position === null) return l.saved === null && r.position === null
  return (
    l.saved.chapter === r.chapter &&
    l.saved.offset === r.offset &&
    JSON.stringify(l.saved.position) === JSON.stringify(r.position)
  )
}

function toWrite(l: LocalListening): ListeningWrite {
  return l.kind === 'episode'
    ? { book: l.book, kind: 'episode', episode: l.episode, positionMs: l.ms, at: l.at }
    : { book: l.book, kind: 'voice', position: l.saved?.position ?? null, offset: l.saved?.offset ?? 0, at: l.at }
}

function mergeReading(local: readonly RecentReading[], remote: readonly ReadingPlace[]) {
  const remoteBy = new Map(remote.map((p) => [p.book, p]))
  const floor = floorOf(
    remote.map((p) => p.at),
    READ_LIMITS.reading,
  )
  const list: RecentReading[] = []
  const push: ReadingWrite[] = []
  let changed = false
  const pushEntry = (e: RecentReading) => {
    const position = e.position ?? positionFromHref(e.href)
    if (position) push.push({ book: e.bookSlug, position, at: e.at })
  }
  for (const e of local) {
    const r = remoteBy.get(e.bookSlug)
    remoteBy.delete(e.bookSlug)
    if (!r) {
      if (e.at > floor) pushEntry(e)
      list.push(e)
    } else if (isNewer(e.at, r.at)) {
      pushEntry(e)
      list.push(e)
    } else {
      const theirs = toEntry(r)
      if (!sameEntry(e, theirs)) changed = true
      list.push(theirs)
    }
  }
  for (const r of remoteBy.values()) {
    changed = true
    list.push(toEntry(r))
  }
  return { list, push, changed }
}

function mergeListening(local: readonly LocalListening[], remote: readonly ListeningPlace[]) {
  const remoteBy = new Map(remote.map((r) => [listeningKey(r), r]))
  const floor = floorOf(
    remote.map((r) => r.at),
    READ_LIMITS.listening,
  )
  const write: ListeningPlace[] = []
  const push: ListeningWrite[] = []
  for (const l of local) {
    const key = listeningKey(l)
    const r = remoteBy.get(key)
    remoteBy.delete(key)
    if (!r) {
      if (l.at > floor) push.push(toWrite(l))
    } else if (isNewer(l.at, r.at)) push.push(toWrite(l))
    else if (isNewer(r.at, l.at) || !sameListening(l, r)) write.push(r)
  }
  write.push(...remoteBy.values())
  return { write, push }
}

export function merge(local: LocalState, remote: Ready, username: string): MergeResult {
  const write: LocalChanges = local.account === username ? {} : { account: username }
  if (local.account !== null && local.account !== username) {
    write.reading = remote.reading.map(toEntry)
    write.listening = { replace: true, items: remote.listening }
    if (remote.settings) write.settings = { values: remote.settings.values, at: remote.settings.at }
    return {
      write,
      push: {},
      replaced: true,
      changed: ['reading', 'listening', ...(remote.settings ? (['settings'] as const) : [])],
    }
  }

  const push: SyncBatch = {}
  const changed: SyncKind[] = []

  const reading = mergeReading(local.reading, remote.reading)
  if (reading.changed) {
    write.reading = reading.list
    changed.push('reading')
  }
  if (reading.push.length) push.reading = reading.push

  const listening = mergeListening(local.listening, remote.listening)
  if (listening.write.length) {
    write.listening = { replace: false, items: listening.write }
    changed.push('listening')
  }
  if (listening.push.length) push.listening = listening.push

  const mine = local.settings
  const theirs = remote.settings
  if (theirs && (!mine || isNewer(theirs.at, mine.at) || (theirs.at === mine.at && !sameValues(mine, theirs)))) {
    write.settings = { values: theirs.values, at: theirs.at }
    changed.push('settings')
  } else if (mine && (!theirs || isNewer(mine.at, theirs.at))) push.settings = mine

  return { write, push, replaced: false, changed }
}

const sameValues = ({ values: a }: { values: SyncedSettings }, { values: b }: { values: SyncedSettings }) =>
  a.theme === b.theme && a.font === b.font && a.leading === b.leading && a.measure === b.measure
