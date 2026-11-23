export const SPEED_KEY = 'player-speed'
const PREFIX = 'listen-pos:'
const LEGACY_PREFIX = 'player-pos:'

export const episodeKey = (book: string, episode: string) => `${PREFIX}${book}:${episode}`
export const legacyEpisodeKey = (audioUrl: string) => `${LEGACY_PREFIX}${audioUrl}`

export interface EpisodeStamp {
  ms: number | null
  at: number
}

export interface StoredEpisode extends EpisodeStamp {
  book: string
  episode: string
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

function parseEntry(raw: string | null): EpisodeStamp | null {
  try {
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    if (value?.v !== 1 || !isCount(value.at)) return null
    if (value.done === true) return { ms: null, at: value.at }
    return isCount(value.ms) ? { ms: value.ms, at: value.at } : null
  } catch {
    return null
  }
}

export function readEpisode(storage: Storage | null, book: string, episode: string, legacyUrl?: string): EpisodeStamp {
  try {
    const stored = parseEntry(storage?.getItem(episodeKey(book, episode)) ?? null)
    if (stored) return stored
    if (legacyUrl === undefined) return { ms: null, at: 0 }
    const legacy = Number(storage?.getItem(legacyEpisodeKey(legacyUrl)))
    return { ms: Number.isFinite(legacy) && legacy > 0 ? Math.round(legacy) : null, at: 0 }
  } catch {
    return { ms: null, at: 0 }
  }
}

function writeEntry(storage: Storage | null, key: string, value: object, legacyUrl?: string): void {
  try {
    storage?.setItem(key, JSON.stringify({ v: 1, ...value }))
    if (legacyUrl !== undefined) storage?.removeItem(legacyEpisodeKey(legacyUrl))
  } catch {}
}

export function writeEpisode(
  storage: Storage | null,
  book: string,
  episode: string,
  ms: number,
  at: number,
  legacyUrl?: string,
): void {
  writeEntry(storage, episodeKey(book, episode), { ms: Math.max(0, Math.round(ms)), at }, legacyUrl)
}

export function finishEpisode(
  storage: Storage | null,
  book: string,
  episode: string,
  at: number,
  legacyUrl?: string,
): void {
  writeEntry(storage, episodeKey(book, episode), { done: true, at }, legacyUrl)
}

export function listEpisodes(storage: Storage | null): StoredEpisode[] {
  try {
    if (!storage) return []
    const found: StoredEpisode[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(PREFIX)) continue
      const rest = key.slice(PREFIX.length)
      const split = rest.indexOf(':')
      const stamp = parseEntry(storage.getItem(key))
      if (split < 1 || split === rest.length - 1 || !stamp) continue
      found.push({ book: rest.slice(0, split), episode: rest.slice(split + 1), ...stamp })
    }
    return found
  } catch {
    return []
  }
}

export function continueEpisode(storage: Storage | null, book: string, episodes: readonly string[]): string | null {
  const last = listEpisodes(storage)
    .filter((e) => e.book === book && episodes.includes(e.episode))
    .reduce<StoredEpisode | null>((newest, e) => (!newest || e.at > newest.at ? e : newest), null)
  if (!last) return null
  if (last.ms !== null) return last.episode
  return episodes[episodes.indexOf(last.episode) + 1] ?? null
}

export function forgetPrivateEpisodes(storage: Storage | null): void {
  try {
    for (const e of listEpisodes(storage))
      if (e.book.startsWith('u-')) storage?.removeItem(episodeKey(e.book, e.episode))
  } catch {}
}

export function readSpeed(storage: Storage | null): number | null {
  try {
    const value = Number(storage?.getItem(SPEED_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

export function writeSpeed(storage: Storage | null, speed: number): void {
  try {
    storage?.setItem(SPEED_KEY, String(speed))
  } catch {}
}
