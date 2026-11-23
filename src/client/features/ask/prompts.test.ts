import { describe, expect, it } from 'vitest'
import { menuHeading, promptsFor } from './prompts'

const prompts = [
  { id: 'a', name: 'A', appliesTo: 'pages' as const },
  { id: 'b', name: 'B', appliesTo: 'passage' as const },
  { id: 'c', name: 'C', appliesTo: 'pages' as const },
  { id: 'd', name: 'D', appliesTo: 'passage' as const },
]

describe('promptsFor', () => {
  it('lists the pages prompts without a quote and the passage prompts with one, in order', () => {
    expect(promptsFor(prompts, false).map((p) => p.id)).toEqual(['a', 'c'])
    expect(promptsFor(prompts, true).map((p) => p.id)).toEqual(['b', 'd'])
    expect(promptsFor([], true)).toEqual([])
  })
})

describe('menuHeading', () => {
  it('says what the prompts run on', () => {
    expect(menuHeading(true)).toBe('For this passage')
    expect(menuHeading(false)).toBe('For the pages you’ve read')
  })
})
