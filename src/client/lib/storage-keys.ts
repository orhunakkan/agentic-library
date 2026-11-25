/** The page's localStorage, or null where there is none or the browser refuses access to it. */
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The string stored under `key`, or null when there is none or storage can't be read. */
export function readItem(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Stores `value` under `key`; false when there is no storage or it refuses the write. */
export function writeItem(storage: Storage | null, key: string, value: string): boolean {
  try {
    if (!storage) return false
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeKeys(storage: Storage | null, matches: (key: string) => boolean): void {
  try {
    if (!storage) return
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && matches(key)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {}
}
