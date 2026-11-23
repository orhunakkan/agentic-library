import { isTranslateLanguage, type TranslateLanguage } from '~/shared/lookup/languages'
import { browserStorage } from '../ask/thread-store'

export const LOOKUP_PREFS_KEY = 'lookup-prefs'

export function readTarget(storage: Storage | null = browserStorage()): TranslateLanguage | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(LOOKUP_PREFS_KEY) ?? 'null')
    const to = typeof value === 'object' && value !== null ? (value as { to?: unknown }).to : undefined
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
