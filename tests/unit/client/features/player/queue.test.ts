import { describe, expect, it } from 'vitest'
import { neighbours, nextSpeed } from '~/client/features/player/queue'

const episodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('neighbours', () => {
  it('stays inside the current book', () => {
    expect(neighbours(episodes, 'b')).toEqual({ prev: episodes[0], next: episodes[2] })
  })

  it('has no previous at the first episode and no next at the last', () => {
    expect(neighbours(episodes, 'a').prev).toBeUndefined()
    expect(neighbours(episodes, 'c').next).toBeUndefined()
  })
})

describe('nextSpeed', () => {
  it('cycles 1 → 1.25 → 1.5 → 1.75 → 2 → 0.75 → 1', () => {
    const seen = [1]
    for (let i = 0; i < 6; i++) seen.push(nextSpeed(seen.at(-1) ?? 1))
    expect(seen).toEqual([1, 1.25, 1.5, 1.75, 2, 0.75, 1])
  })

  it('recovers from an unknown speed', () => {
    expect(nextSpeed(3)).toBe(1)
  })
})
