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
