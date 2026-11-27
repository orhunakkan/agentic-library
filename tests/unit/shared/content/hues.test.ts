import { describe, expect, it } from 'vitest'
import { collectionHues } from '~/shared/content/hues'

const collection = (slug: string, order: number, tone: 'warm' | 'default' = 'default') => ({ slug, order, tone })

describe('collectionHues', () => {
  it('assigns hues in collection order, not list order', () => {
    const hues = collectionHues([collection('b', 2), collection('a', 1)])
    expect([...hues]).toEqual([
      ['a', 'violet'],
      ['b', 'coral'],
    ])
  })

  it('makes warm-tone collections amber without using up a hue', () => {
    const hues = collectionHues([collection('paged', 0, 'warm'), collection('first', 1), collection('second', 2)])
    expect(hues.get('paged')).toBe('amber')
    expect(hues.get('first')).toBe('violet')
    expect(hues.get('second')).toBe('coral')
  })

  it('cycles past five collections', () => {
    const hues = collectionHues(Array.from({ length: 7 }, (_, i) => collection(`c${i}`, i)))
    expect([...hues.values()]).toEqual(['violet', 'coral', 'cyan', 'lime', 'pink', 'violet', 'coral'])
  })
})
