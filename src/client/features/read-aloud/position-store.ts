import { removeKeys } from '~/client/lib/storage-keys'
import { hasPrivateSlugPrefix } from '~/shared/content/book-slug'
import type { PagePosition } from '~/shared/content/position'
import type { ListeningWrite } from '~/shared/sync/sync'

export interface SavedPosition {
  v: 1
  chapter: number
  position: PagePosition
  offset: number
  at: number
}

export interface PositionStamp {
  book: string
  saved: SavedPosition | null
  at: number
}

const PREFIX = 'read-aloud-pos:'

export const positionKey = (bookSlug: string) => `${PREFIX}${bookSlug}`
export const SPEED_KEY = 'read-aloud-speed'
export const VOICE_KEY = 'read-aloud-voice'
export const FOLIO_OFFER_KEY = 'read-aloud-folio-offer'
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

function pagePosition(value: unknown): PagePosition | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Record<string, unknown>
  if (isCount(p.printedPage)) return { printedPage: p.printedPage }
  if (typeof p.chapter === 'string' && p.chapter && isCount(p.page) && p.page >= 1)
    return { chapter: p.chapter, page: p.page }
  return null
}

function parseEntry(raw: string | null): SavedPosition | { done: true; at: number } | null {
  try {
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    if (value?.v !== 1) return null
    const at = isCount(value.at) ? value.at : 0
    if (value.done === true) return { done: true, at }
    const position = pagePosition(value.position)
    if (!isCount(value.chapter) || !isCount(value.offset) || !position) return null
    return { v: 1, chapter: value.chapter, position, offset: value.offset, at }
  } catch {
    return null
  }
}

export function parsePosition(raw: string | null): SavedPosition | null {
  const entry = parseEntry(raw)
  return entry && 'v' in entry ? entry : null
}

export function readPosition(storage: Storage | null, bookSlug: string): SavedPosition | null {
  try {
    return parsePosition(storage?.getItem(positionKey(bookSlug)) ?? null)
  } catch {
    return null
  }
}

export function writePosition(storage: Storage | null, bookSlug: string, saved: Omit<SavedPosition, 'v'>): void {
  try {
    storage?.setItem(positionKey(bookSlug), JSON.stringify({ v: 1, ...saved }))
  } catch {}
}

export function finishPosition(storage: Storage | null, bookSlug: string, at: number): void {
  try {
    storage?.setItem(positionKey(bookSlug), JSON.stringify({ v: 1, done: true, at }))
  } catch {}
}

export function readStamp(storage: Storage | null, bookSlug: string): { at: number; done: boolean } | null {
  try {
    const entry = parseEntry(storage?.getItem(positionKey(bookSlug)) ?? null)
    return entry && { at: entry.at, done: 'done' in entry }
  } catch {
    return null
  }
}

export function voiceItem(
  storage: Storage | null,
  book: string,
  saved: Omit<SavedPosition, 'v'> | null,
  now: number,
): ListeningWrite {
  if (saved) return { book, kind: 'voice', position: saved.position, offset: saved.offset, at: saved.at }
  return { book, kind: 'voice', position: null, offset: 0, at: readStamp(storage, book)?.at ?? now }
}

export function listPositions(storage: Storage | null): PositionStamp[] {
  try {
    if (!storage) return []
    const found: PositionStamp[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(PREFIX)) continue
      const entry = parseEntry(storage.getItem(key))
      if (entry) found.push({ book: key.slice(PREFIX.length), saved: 'v' in entry ? entry : null, at: entry.at })
    }
    return found
  } catch {
    return []
  }
}

export function readSpeed(storage: Storage | null): number {
  try {
    const value = Number(storage?.getItem(SPEED_KEY))
    return SPEEDS.includes(value) ? value : 1
  } catch {
    return 1
  }
}

export function writeSpeed(storage: Storage | null, speed: number): void {
  try {
    storage?.setItem(SPEED_KEY, String(speed))
  } catch {}
}

export function readVoices(storage: Storage | null): Record<string, string> {
  try {
    const value = JSON.parse(storage?.getItem(VOICE_KEY) ?? 'null') as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    )
  } catch {
    return {}
  }
}

export function rememberVoice(storage: Storage | null, lang: string, voiceURI: string): void {
  try {
    storage?.setItem(VOICE_KEY, JSON.stringify({ ...readVoices(storage), [lang]: voiceURI }))
  } catch {}
}

export const voiceChoiceKey = (lang: string, privateBook: boolean) => (privateBook ? `${lang}:private` : lang)

export function rememberedVoice(storage: Storage | null, lang: string, privateBook: boolean): string | undefined {
  const voices = readVoices(storage)
  if (!privateBook) return voices[lang]
  const own = voices[voiceChoiceKey(lang, true)]
  if (own) return own
  const shared = voices[lang]
  return shared?.startsWith('elevenlabs:') ? undefined : shared
}

export function forgetVoice(storage: Storage | null, key: string, voiceURI: string): void {
  try {
    const voices = readVoices(storage)
    if (voices[key] !== voiceURI) return
    delete voices[key]
    storage?.setItem(VOICE_KEY, JSON.stringify(voices))
  } catch {}
}

export function clearPrivatePositions(storage: Storage | null): void {
  removeKeys(storage, (key) => key.startsWith(PREFIX) && hasPrivateSlugPrefix(key.slice(PREFIX.length)))
}

export function offerDismissed(storage: Storage | null): boolean {
  try {
    const value = JSON.parse(storage?.getItem(FOLIO_OFFER_KEY) ?? 'null') as { v?: unknown; dismissed?: unknown } | null
    return value?.v === 1 && value.dismissed === true
  } catch {
    return false
  }
}

export function dismissOffer(storage: Storage | null): void {
  try {
    storage?.setItem(FOLIO_OFFER_KEY, JSON.stringify({ v: 1, dismissed: true }))
  } catch {}
}
