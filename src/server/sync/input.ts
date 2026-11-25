import { type PagePosition, parsePosition } from '~/shared/content/position'
import { MAX_SESSION_SECONDS } from '~/shared/reading-stats/contract'
import { isDay, isTimeZone } from '~/shared/reading-stats/days'
import {
  isNewer,
  itemKey,
  type ListeningWrite,
  MAX_BATCH_ITEMS,
  parseSyncedSettings,
  type ReadingWrite,
  type SettingsWrite,
  type SyncBatch,
  type TimeWrite,
} from '~/shared/sync/sync'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { exactly, isObject, only } from '../../shared/lib/json-shape.ts'

const MAX_OFFSET = 1_000_000
const MAX_POSITION_MS = 86_400_000

const isCount = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isEpisodeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= 200

function readingItem(value: unknown, now: number): ReadingWrite | null {
  if (!isObject(value) || !exactly(value, ['book', 'position', 'at'])) return null
  const position = parsePosition(value.position)
  if (!isBookSlug(value.book) || !position || !isCount(value.at)) return null
  return { book: value.book, position, at: Math.min(value.at, now) }
}

function listeningItem(value: unknown, now: number): ListeningWrite | null {
  if (!isObject(value) || !isBookSlug(value.book) || !isCount(value.at)) return null
  const at = Math.min(value.at, now)
  if (value.kind === 'episode') {
    if (!exactly(value, ['book', 'kind', 'episode', 'positionMs', 'at']) || !isEpisodeId(value.episode)) return null
    if (value.positionMs !== null && !isCount(value.positionMs, MAX_POSITION_MS)) return null
    return { book: value.book, kind: 'episode', episode: value.episode, positionMs: value.positionMs, at }
  }
  if (value.kind === 'voice') {
    if (!exactly(value, ['book', 'kind', 'position', 'offset', 'at']) || !isCount(value.offset, MAX_OFFSET)) return null
    let position: PagePosition | null = null
    if (value.position !== null) {
      position = parsePosition(value.position)
      if (!position) return null
    } else if (value.offset !== 0) return null
    return { book: value.book, kind: 'voice', position, offset: value.offset, at }
  }
  return null
}

function settingsItem(value: unknown, now: number): SettingsWrite | null {
  if (!isObject(value) || !exactly(value, ['values', 'at']) || !isCount(value.at)) return null
  const values = parseSyncedSettings(value.values)
  return values && { values, at: Math.min(value.at, now) }
}

function timeItem(value: unknown, now: number): TimeWrite | null {
  if (!isObject(value) || !exactly(value, ['id', 'kind', 'day', 'seconds', 'at'])) return null
  if (typeof value.id !== 'string' || !UUID.test(value.id)) return null
  if (value.kind !== 'reading' && value.kind !== 'listening') return null
  if (!isDay(value.day) || !isCount(value.seconds, MAX_SESSION_SECONDS) || value.seconds < 1 || !isCount(value.at))
    return null
  return {
    id: value.id.toLowerCase(),
    kind: value.kind,
    day: value.day,
    seconds: value.seconds,
    at: Math.min(value.at, now),
  }
}

function list<T extends ReadingWrite | ListeningWrite | TimeWrite>(
  value: unknown,
  parse: (item: unknown, now: number) => T | null,
  now: number,
): T[] | null {
  if (!Array.isArray(value) || value.length > MAX_BATCH_ITEMS) return null
  const kept = new Map<string, T>()
  for (const raw of value) {
    const item = parse(raw, now)
    if (!item) return null
    const key = itemKey(item)
    const there = kept.get(key)
    if (there && isNewer(there.at, item.at)) continue
    kept.delete(key)
    kept.set(key, item)
  }
  return [...kept.values()]
}

export function parseSyncBatch(value: unknown, now: number): SyncBatch | null {
  if (!isObject(value) || !only(value, ['reading', 'listening', 'settings', 'time', 'zone'])) return null
  if (!('reading' in value) && !('listening' in value) && !('settings' in value) && !('time' in value)) return null
  if ('zone' in value && !('time' in value)) return null
  const batch: SyncBatch = {}
  if ('reading' in value) {
    const reading = list(value.reading, readingItem, now)
    if (!reading) return null
    batch.reading = reading
  }
  if ('listening' in value) {
    const listening = list(value.listening, listeningItem, now)
    if (!listening) return null
    batch.listening = listening
  }
  if ('settings' in value) {
    const settings = settingsItem(value.settings, now)
    if (!settings) return null
    batch.settings = settings
  }
  if ('time' in value) {
    const time = list(value.time, timeItem, now)
    if (!time) return null
    batch.time = time
  }
  if ('zone' in value) {
    if (!isTimeZone(value.zone)) return null
    batch.zone = value.zone
  }
  return batch
}
