import { finishEpisode, listEpisodes, writeEpisode } from '~/client/features/player/position-store'
import {
  finishPosition,
  listPositions,
  type SavedPosition,
  writePosition,
} from '~/client/features/read-aloud/position-store'
import { type RecentReading, readRecent, writeRecent } from '~/client/features/reader/continue-reading'
import { PREFS_AT_KEY, PREFS_KEY, parsePrefs, pickSynced, withSynced } from '~/client/features/reader/prefs'
import { readItem, removeKeys } from '~/client/lib/storage-keys'
import type { ListeningPlace, SyncedSettings } from '~/shared/sync/sync'

export const ACCOUNT_KEY = 'sync-account'
const LISTENING_PREFIXES = ['listen-pos:', 'read-aloud-pos:', 'player-pos:']

export type LocalListening =
  | { kind: 'episode'; book: string; episode: string; ms: number | null; at: number }
  | { kind: 'voice'; book: string; saved: SavedPosition | null; at: number }

export interface LocalSettings {
  values: SyncedSettings
  at: number
}

export interface LocalState {
  account: string | null
  reading: RecentReading[]
  listening: LocalListening[]
  settings: LocalSettings | null
}

export interface LocalChanges {
  account?: string
  reading?: RecentReading[]
  listening?: { replace: boolean; items: ListeningPlace[] }
  settings?: LocalSettings
}

const set = (storage: Storage | null, key: string, value: string) => {
  try {
    storage?.setItem(key, value)
  } catch {}
}

export function readLocal(storage: Storage | null, siteDark: boolean): LocalState {
  const prefs = readItem(storage, PREFS_KEY)
  const at = Number(readItem(storage, PREFS_AT_KEY))
  return {
    account: readItem(storage, ACCOUNT_KEY),
    reading: readRecent(storage),
    listening: [
      ...listEpisodes(storage).map((e): LocalListening => ({ kind: 'episode', ...e })),
      ...listPositions(storage).map((p): LocalListening => ({ kind: 'voice', ...p })),
    ],
    settings:
      prefs === null
        ? null
        : { values: pickSynced(parsePrefs(prefs, siteDark)), at: Number.isInteger(at) && at > 0 ? at : 0 },
  }
}

function forgetListening(storage: Storage | null) {
  removeKeys(storage, (key) => LISTENING_PREFIXES.some((p) => key.startsWith(p)))
}

function writeListening(storage: Storage | null, item: ListeningPlace) {
  if (item.kind === 'episode') {
    if (item.positionMs === null) finishEpisode(storage, item.book, item.episode, item.at)
    else writeEpisode(storage, item.book, item.episode, item.positionMs, item.at)
    return
  }
  if (item.position === null) finishPosition(storage, item.book, item.at)
  else
    writePosition(storage, item.book, {
      chapter: item.chapter,
      position: item.position,
      offset: item.offset,
      at: item.at,
    })
}

export function writeLocal(storage: Storage | null, changes: LocalChanges, siteDark: boolean): void {
  if (changes.reading) writeRecent(storage, changes.reading)
  if (changes.listening) {
    if (changes.listening.replace) forgetListening(storage)
    for (const item of changes.listening.items) writeListening(storage, item)
  }
  if (changes.settings) {
    const prefs = withSynced(parsePrefs(readItem(storage, PREFS_KEY), siteDark), changes.settings.values)
    set(storage, PREFS_KEY, JSON.stringify(prefs))
    set(storage, PREFS_AT_KEY, String(changes.settings.at))
  }
  if (changes.account !== undefined) set(storage, ACCOUNT_KEY, changes.account)
}
