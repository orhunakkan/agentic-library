import { beforeEach, describe, expect, it } from 'vitest'
import {
  find,
  hold,
  PENDING_PER_USER,
  PENDING_TTL_MS,
  pictureAllowed,
  resetPending,
  take,
} from '~/server/articles/pending'

beforeEach(() => resetPending())

describe('pending fetches', () => {
  it('holds a fetch for its reader only', () => {
    const id = hold(1, 'https://a.test/x', ['https://a.test/p.jpg'], 1000)
    expect(find(1, id, 1000)).toMatchObject({ userId: 1, url: 'https://a.test/x' })
    expect(find(2, id, 1000)).toBeNull()
    expect(find(1, 'nope', 1000)).toBeNull()
  })

  it('lasts 30 minutes', () => {
    const id = hold(1, 'https://a.test/x', [], 0)
    expect(find(1, id, PENDING_TTL_MS - 1)).not.toBeNull()
    expect(find(1, id, PENDING_TTL_MS)).toBeNull()
    expect(find(1, id, 0)).toBeNull()
  })

  it('sweeps expired fetches when another is held', () => {
    const old = hold(1, 'https://a.test/old', [], 0)
    hold(2, 'https://a.test/new', [], PENDING_TTL_MS)
    expect(find(1, old, 0)).toBeNull()
  })

  it('keeps a reader’s 10 newest', () => {
    const ids = Array.from({ length: PENDING_PER_USER + 2 }, (_, i) => hold(1, `https://a.test/${i}`, [], i))
    const other = hold(2, 'https://a.test/other', [], 0)
    expect(find(1, ids[0] as string, 20)).toBeNull()
    expect(find(1, ids[1] as string, 20)).toBeNull()
    expect(find(1, ids[2] as string, 20)).not.toBeNull()
    expect(find(1, ids.at(-1) as string, 20)).not.toBeNull()
    expect(find(2, other, 20)).not.toBeNull()
  })

  it('is taken once', () => {
    const id = hold(1, 'https://a.test/x', [], 0)
    expect(take(2, id, 0)).toBeNull()
    expect(take(1, id, 0)).toMatchObject({ url: 'https://a.test/x' })
    expect(take(1, id, 0)).toBeNull()
  })

  it('allows only its own pictures', () => {
    const id = hold(1, 'https://a.test/x', ['https://a.test/p.jpg'], 0)
    expect(pictureAllowed(1, id, 'https://a.test/p.jpg', 0)).toBe(true)
    expect(pictureAllowed(1, id, 'https://a.test/q.jpg', 0)).toBe(false)
    expect(pictureAllowed(2, id, 'https://a.test/p.jpg', 0)).toBe(false)
    expect(pictureAllowed(1, id, 'https://a.test/p.jpg', PENDING_TTL_MS)).toBe(false)
  })
})
