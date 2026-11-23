import type { PagePosition } from '../highlights/page-text.ts'

export const READER_THEMES = ['light', 'sepia', 'dark'] as const
export const READER_FONTS = ['literata', 'source-serif', 'geist', 'atkinson', 'opendyslexic'] as const
export const LEADINGS = ['compact', 'normal', 'relaxed'] as const
export const MEASURES = ['narrow', 'normal', 'wide'] as const

export interface SyncedSettings {
  theme: (typeof READER_THEMES)[number]
  font: (typeof READER_FONTS)[number]
  leading: (typeof LEADINGS)[number]
  measure: (typeof MEASURES)[number]
}

const SETTINGS_KEYS = ['theme', 'font', 'leading', 'measure'] as const

const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)

export function parseSyncedSettings(value: unknown): SyncedSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const keys = Object.keys(v)
  if (keys.length !== SETTINGS_KEYS.length || !SETTINGS_KEYS.every((k) => keys.includes(k))) return null
  if (
    !isOneOf(v.theme, READER_THEMES) ||
    !isOneOf(v.font, READER_FONTS) ||
    !isOneOf(v.leading, LEADINGS) ||
    !isOneOf(v.measure, MEASURES)
  )
    return null
  return { theme: v.theme, font: v.font, leading: v.leading, measure: v.measure }
}

export const MAX_BATCH_ITEMS = 20
export const READ_LIMITS = { reading: 50, listening: 100 } as const

export interface ReadingWrite {
  book: string
  position: PagePosition
  at: number
}
export type ListeningWrite =
  | { book: string; kind: 'episode'; episode: string; positionMs: number | null; at: number }
  | { book: string; kind: 'voice'; position: PagePosition | null; offset: number; at: number }
export interface SettingsWrite {
  values: SyncedSettings
  at: number
}
export interface TimeWrite {
  id: string
  kind: 'reading' | 'listening'
  day: string
  seconds: number
  at: number
}
export interface SyncBatch {
  reading?: ReadingWrite[]
  listening?: ListeningWrite[]
  settings?: SettingsWrite
  time?: TimeWrite[]
  zone?: string
}

export interface ReadingPlace {
  book: string
  bookTitle: string
  chapterTitle: string
  href: string
  label: string
  position: PagePosition
  at: number
  device: string
}
export type ListeningPlace =
  | { book: string; kind: 'episode'; episode: string; positionMs: number | null; at: number; device: string }
  | {
      book: string
      kind: 'voice'
      chapter: number
      position: PagePosition | null
      offset: number
      at: number
      device: string
    }
export interface SettingsPlace {
  values: SyncedSettings
  at: number
  device: string
}

export type SyncState =
  | { state: 'signed_out' }
  | { state: 'unavailable' }
  | { state: 'ready'; reading: ReadingPlace[]; listening: ListeningPlace[]; settings: SettingsPlace | null }

type Keyed =
  | Pick<TimeWrite, 'id' | 'seconds'>
  | Pick<ReadingWrite, 'book' | 'position'>
  | Pick<Extract<ListeningWrite, { kind: 'episode' }>, 'book' | 'kind' | 'episode'>
  | Pick<Extract<ListeningWrite, { kind: 'voice' }>, 'book' | 'kind'>

export function itemKey(item: Keyed | 'settings'): string {
  if (item === 'settings') return 'settings'
  if ('seconds' in item) return `t:${item.id}`
  if (!('kind' in item)) return `r:${item.book}`
  return item.kind === 'episode' ? `e:${item.book}:${item.episode}` : `v:${item.book}`
}

export const isNewer = (a: number, b: number) => a > b
