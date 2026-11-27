import { describe, expect, it } from 'vitest'
import { removeKeys } from '~/client/lib/storage-keys'

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  }
}

describe('removeKeys', () => {
  it('removes every matching key, including neighbours that renumber as others go', () => {
    const storage = memoryStorage({ 'ask:u-1': 'a', 'ask:u-2': 'b', 'ask:pride': 'c', 'ask:u-3': 'd' })
    removeKeys(storage, (key) => key.startsWith('ask:u-'))
    expect(storage.length).toBe(1)
    expect(storage.key(0)).toBe('ask:pride')
  })

  it('leaves the store alone when nothing matches', () => {
    const storage = memoryStorage({ theme: 'dark' })
    removeKeys(storage, () => false)
    expect(storage.getItem('theme')).toBe('dark')
  })

  it('does nothing without a store', () => {
    expect(() => removeKeys(null, () => true)).not.toThrow()
  })

  it('ignores a store that throws', () => {
    const blocked = {
      get length(): number {
        throw new Error('SecurityError')
      },
    } as unknown as Storage
    expect(() => removeKeys(blocked, () => true)).not.toThrow()
  })
})
