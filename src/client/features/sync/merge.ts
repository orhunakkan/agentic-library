import type { RecentReading } from '~/client/features/reader/continue-reading'
import { isPrivateBookSlug } from '~/shared/content/book-slug'
import { positionFromHref } from '~/shared/content/position'
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

export const toEntry = (place: ReadingPlace): RecentReading => ({
  bookSlug: place.book,
  bookTitle: place.bookTitle,
  chapterTitle: place.chapterTitle,
  href: place.href,
  at: place.at,
  position: place.position,
  label: place.label,
  device: place.device,
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

function sameListening(localPlace: LocalListening, remotePlace: ListeningPlace): boolean {
  if (localPlace.kind === 'episode') return remotePlace.kind === 'episode' && localPlace.ms === remotePlace.positionMs
  if (remotePlace.kind !== 'voice') return false
  if (localPlace.saved === null || remotePlace.position === null)
    return localPlace.saved === null && remotePlace.position === null
  return (
    localPlace.saved.chapter === remotePlace.chapter &&
    localPlace.saved.offset === remotePlace.offset &&
    JSON.stringify(localPlace.saved.position) === JSON.stringify(remotePlace.position)
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
  /** An entry saved before entries stored a position is read from its href; only a private book's kind is known from its slug. */
  const pushEntry = (e: RecentReading) => {
    const position = e.position ?? positionFromHref(e.href, isPrivateBookSlug(e.bookSlug) ? 'chapter' : null)
    if (position) push.push({ book: e.bookSlug, position, at: e.at })
  }
  for (const entry of local) {
    const remotePlace = remoteBy.get(entry.bookSlug)
    remoteBy.delete(entry.bookSlug)
    if (!remotePlace) {
      if (entry.at > floor) pushEntry(entry)
      list.push(entry)
    } else if (isNewer(entry.at, remotePlace.at)) {
      pushEntry(entry)
      list.push(entry)
    } else {
      const theirs = toEntry(remotePlace)
      if (!sameEntry(entry, theirs)) changed = true
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
  for (const localPlace of local) {
    const key = listeningKey(localPlace)
    const remotePlace = remoteBy.get(key)
    remoteBy.delete(key)
    if (!remotePlace) {
      if (localPlace.at > floor) push.push(toWrite(localPlace))
    } else if (isNewer(localPlace.at, remotePlace.at)) push.push(toWrite(localPlace))
    else if (isNewer(remotePlace.at, localPlace.at) || !sameListening(localPlace, remotePlace)) write.push(remotePlace)
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
