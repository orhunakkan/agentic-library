import { isOneOf } from '~/shared/lib/json-shape'
import { LEADINGS, MEASURES, READER_FONTS, READER_THEMES, type SyncedSettings } from '~/shared/sync/sync'

export type ReaderTheme = (typeof READER_THEMES)[number]
export type Leading = (typeof LEADINGS)[number]
export type Measure = (typeof MEASURES)[number]
export type ReaderFont = (typeof READER_FONTS)[number]
export type ReaderLayout = 'pages' | 'scroll'

export interface ReaderPrefs {
  theme: ReaderTheme
  font: ReaderFont
  fontSize: number
  leading: Leading
  measure: Measure
  layout: ReaderLayout
  sidebarHidden: boolean
  askOpen: boolean
}

export const PREFS_KEY = 'reader-prefs'
export const PREFS_AT_KEY = 'reader-prefs-at'
const SYNCED_KEYS = ['theme', 'font', 'leading', 'measure'] as const
export const FONT_SIZES = [15, 17, 19, 21, 23, 25, 27] as const
export const LEADING_VALUES: Record<Leading, number> = { compact: 1.6, normal: 1.85, relaxed: 2.15 }
export const MEASURE_VALUES: Record<Measure, number> = { narrow: 560, normal: 660, wide: 780 }
export const FONT_FAMILIES: Record<ReaderFont, string> = {
  literata: '"Literata Variable", ui-serif, Georgia, serif',
  'source-serif': '"Source Serif 4 Variable", ui-serif, Georgia, serif',
  geist: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
  atkinson: '"Atkinson Hyperlegible Next Variable", ui-sans-serif, system-ui, sans-serif',
  opendyslexic: '"OpenDyslexic", ui-sans-serif, system-ui, sans-serif',
}
export const FONT_OPTIONS: { value: ReaderFont; label: string }[] = [
  { value: 'literata', label: 'Literata' },
  { value: 'source-serif', label: 'Source Serif' },
  { value: 'geist', label: 'Geist' },
  { value: 'atkinson', label: 'Atkinson Hyperlegible' },
  { value: 'opendyslexic', label: 'OpenDyslexic' },
]

export const THEME_OPTIONS: { value: ReaderTheme; label: string; swatch: string }[] = [
  { value: 'light', label: 'Light', swatch: 'bg-white text-[#2a3450] border-[#d9dceb]' },
  { value: 'sepia', label: 'Sepia', swatch: 'bg-[#fbf5e9] text-[#443728] border-[#e2d4bc]' },
  { value: 'dark', label: 'Dark', swatch: 'bg-[#171b33] text-[#c9cce3] border-[#2a3056]' },
]
export const LEADING_OPTIONS: { value: Leading; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
]
export const LAYOUT_OPTIONS: { value: ReaderLayout; label: string }[] = [
  { value: 'pages', label: 'Pages' },
  { value: 'scroll', label: 'Scroll' },
]
export const DEFAULT_PREFS: ReaderPrefs = {
  theme: 'light',
  font: 'literata',
  fontSize: 19,
  leading: 'normal',
  measure: 'normal',
  layout: 'pages',
  sidebarHidden: false,
  askOpen: false,
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return isOneOf(value, options) ? value : fallback
}

export function parsePrefs(raw: string | null, siteDark: boolean): ReaderPrefs {
  let saved: Record<string, unknown> | null = null
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (value && typeof value === 'object') saved = value as Record<string, unknown>
  } catch {}
  if (!saved) return { ...DEFAULT_PREFS, theme: siteDark ? 'dark' : 'light' }
  return {
    theme: oneOf(saved.theme, READER_THEMES, DEFAULT_PREFS.theme),
    font: oneOf(saved.font, READER_FONTS, DEFAULT_PREFS.font),
    fontSize: FONT_SIZES.includes(saved.fontSize as never) ? (saved.fontSize as number) : DEFAULT_PREFS.fontSize,
    leading: oneOf(saved.leading, LEADINGS, DEFAULT_PREFS.leading),
    measure: oneOf(saved.measure, MEASURES, DEFAULT_PREFS.measure),
    layout: oneOf(saved.layout, ['pages', 'scroll'], DEFAULT_PREFS.layout),
    sidebarHidden: saved.sidebarHidden === true,
    askOpen: saved.askOpen === true,
  }
}

export function stepFontSize(size: number, direction: 1 | -1): number {
  const index = FONT_SIZES.indexOf(size as never)
  const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, (index < 0 ? 2 : index) + direction))]
  return next ?? DEFAULT_PREFS.fontSize
}

export function pickSynced(prefs: ReaderPrefs): SyncedSettings {
  return { theme: prefs.theme, font: prefs.font, leading: prefs.leading, measure: prefs.measure }
}

export function withSynced(prefs: ReaderPrefs, values: SyncedSettings): ReaderPrefs {
  return { ...prefs, theme: values.theme, font: values.font, leading: values.leading, measure: values.measure }
}

export const changesSynced = (patch: Partial<ReaderPrefs>, current: ReaderPrefs) =>
  SYNCED_KEYS.some((k) => k in patch && patch[k] !== current[k])
