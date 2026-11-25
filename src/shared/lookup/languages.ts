import { isOneOf } from '../lib/json-shape.ts'

export const TRANSLATE_LANGUAGES = [
  'ar',
  'bn',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'fa',
  'fi',
  'fr',
  'he',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'ms',
  'nb',
  'nl',
  'pl',
  'pt',
  'ru',
  'sv',
  'th',
  'tr',
  'uk',
  'ur',
  'vi',
  'zh-Hans',
  'zh-Hant',
] as const

export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number]

export function isTranslateLanguage(value: unknown): value is TranslateLanguage {
  return isOneOf(value, TRANSLATE_LANGUAGES)
}

export function primaryLanguage(tag: string | null | undefined): string {
  const primary = (tag ?? '').split(/[-_]/)[0]?.toLowerCase() ?? ''
  return /^[a-z]{2,3}$/.test(primary) ? primary : 'en'
}

function listCode(tag: string): TranslateLanguage | null {
  const parts = tag.split(/[-_]/)
  const primary = parts[0]?.toLowerCase() ?? ''
  if (primary === 'zh') {
    const rest = parts.slice(1).map((p) => p.toLowerCase())
    return rest.includes('hant') || rest.includes('tw') || rest.includes('hk') ? 'zh-Hant' : 'zh-Hans'
  }
  return isTranslateLanguage(primary) ? primary : null
}

export function defaultTarget(navigatorLanguages: readonly string[], bookLang: string): TranslateLanguage | null {
  const book = primaryLanguage(bookLang)
  for (const tag of navigatorLanguages) {
    const code = listCode(tag)
    if (code && primaryLanguage(code) !== book) return code
  }
  return null
}

const englishNames = new Intl.DisplayNames(['en'], { type: 'language' })

export const englishName = (code: string) => englishNames.of(code) ?? code

export function languageLabel(code: TranslateLanguage): string {
  const english = englishName(code)
  let own = english
  try {
    own = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? english
  } catch {}
  return own.toLowerCase() === english.toLowerCase() ? english : `${english} · ${own}`
}

export function translateOptions(): { code: TranslateLanguage; label: string }[] {
  return TRANSLATE_LANGUAGES.map((code) => ({ code, label: languageLabel(code) })).sort((a, b) =>
    a.label.localeCompare(b.label, 'en'),
  )
}
