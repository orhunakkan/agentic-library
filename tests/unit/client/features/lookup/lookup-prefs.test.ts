import { describe, expect, it } from 'vitest'
import { LOOKUP_PREFS_KEY, readTarget, writeTarget } from '~/client/features/lookup/lookup-prefs'

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

const blocked = new Proxy({} as Storage, {
  get() {
    throw new DOMException('blocked', 'SecurityError')
  },
})

describe('lookup prefs', () => {
  it('round-trips the target language as { to }', () => {
    const storage = memoryStorage()
    expect(readTarget(storage)).toBeNull()
    writeTarget('tr', storage)
    expect(storage.getItem(LOOKUP_PREFS_KEY)).toBe('{"to":"tr"}')
    expect(readTarget(storage)).toBe('tr')
    writeTarget('zh-Hant', storage)
    expect(readTarget(storage)).toBe('zh-Hant')
  })

  it('reads an unknown code, a wrong shape or broken JSON as nothing', () => {
    for (const value of ['{"to":"tlh"}', '{"to":1}', '"tr"', 'null', '[1]', '{broken']) {
      expect(readTarget(memoryStorage({ [LOOKUP_PREFS_KEY]: value })), value).toBeNull()
    }
  })

  it('never throws when storage is blocked or missing', () => {
    expect(readTarget(blocked)).toBeNull()
    expect(() => writeTarget('tr', blocked)).not.toThrow()
    expect(readTarget(null)).toBeNull()
    expect(() => writeTarget('tr', null)).not.toThrow()
  })
})
