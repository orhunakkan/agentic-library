import { readItem, removeKeys, writeItem } from '~/client/lib/storage-keys'
import { hasPrivateSlugPrefix } from '~/shared/content/book-slug'
import { type PagePosition, parsePosition as parsePagePosition } from '~/shared/content/position'
import { isObject } from '~/shared/lib/json-shape'
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

function parseEntry(raw: string | null): SavedPosition | { done: true; at: number } | null {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!isObject(value) || value.v !== 1) return null
    const at = isCount(value.at) ? value.at : 0
    if (value.done === true) return { done: true, at }
    const position = parsePagePosition(value.position)
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
  return parsePosition(readItem(storage, positionKey(bookSlug)))
}

export function writePosition(storage: Storage | null, bookSlug: string, saved: Omit<SavedPosition, 'v'>): void {
  writeItem(storage, positionKey(bookSlug), JSON.stringify({ v: 1, ...saved }))
}

export function finishPosition(storage: Storage | null, bookSlug: string, at: number): void {
  writeItem(storage, positionKey(bookSlug), JSON.stringify({ v: 1, done: true, at }))
}

export function readStamp(storage: Storage | null, bookSlug: string): { at: number; done: boolean } | null {
  const entry = parseEntry(readItem(storage, positionKey(bookSlug)))
  return entry && { at: entry.at, done: 'done' in entry }
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
  const value = Number(readItem(storage, SPEED_KEY))
  return SPEEDS.includes(value) ? value : 1
}

export function writeSpeed(storage: Storage | null, speed: number): void {
  writeItem(storage, SPEED_KEY, String(speed))
}

export function readVoices(storage: Storage | null): Record<string, string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(VOICE_KEY) ?? 'null')
    if (!isObject(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return {}
  }
}

export function rememberVoice(storage: Storage | null, lang: string, voiceURI: string): void {
  writeItem(storage, VOICE_KEY, JSON.stringify({ ...readVoices(storage), [lang]: voiceURI }))
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
    const value: unknown = JSON.parse(storage?.getItem(FOLIO_OFFER_KEY) ?? 'null')
    return isObject(value) && value.v === 1 && value.dismissed === true
  } catch {
    return false
  }
}

export function dismissOffer(storage: Storage | null): void {
  writeItem(storage, FOLIO_OFFER_KEY, JSON.stringify({ v: 1, dismissed: true }))
}
