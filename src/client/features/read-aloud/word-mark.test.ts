import { describe, expect, it, vi } from 'vitest'
import { createWordMark } from './word-mark'

describe('createWordMark', () => {
  it('tells its listeners about each change, once, until they unsubscribe', () => {
    const mark = createWordMark()
    const listener = vi.fn()
    const unsubscribe = mark.subscribe(listener)
    mark.set({ start: 0, end: 3 })
    mark.set({ start: 0, end: 3 })
    mark.set({ start: 4, end: 9 })
    mark.set(null)
    mark.set(null)
    expect(listener.mock.calls).toEqual([[{ start: 0, end: 3 }], [{ start: 4, end: 9 }], [null]])
    unsubscribe()
    mark.set({ start: 1, end: 2 })
    expect(listener).toHaveBeenCalledTimes(3)
    expect(mark.get()).toEqual({ start: 1, end: 2 })
  })
})
