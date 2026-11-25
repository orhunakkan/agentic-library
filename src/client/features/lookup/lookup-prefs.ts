import { browserStorage } from '~/client/lib/storage-keys'
import { isObject } from '~/shared/lib/json-shape'
import { isTranslateLanguage, type TranslateLanguage } from '~/shared/lookup/languages'

export const LOOKUP_PREFS_KEY = 'lookup-prefs'

export function readTarget(storage: Storage | null = browserStorage()): TranslateLanguage | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(LOOKUP_PREFS_KEY) ?? 'null')
    const to = isObject(value) ? value.to : undefined
    return isTranslateLanguage(to) ? to : null
  } catch {
    return null
  }
}

export function writeTarget(to: TranslateLanguage, storage: Storage | null = browserStorage()): void {
  try {
    storage?.setItem(LOOKUP_PREFS_KEY, JSON.stringify({ to }))
  } catch {}
}
