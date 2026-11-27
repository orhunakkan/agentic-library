import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug } from '~/shared/import/slug'

describe('slugify', () => {
  it('lowercases, strips accents and joins words with hyphens', () => {
    expect(slugify('Project: A Robot')).toBe('project-a-robot')
    expect(slugify('Café Déjà Vu')).toBe('cafe-deja-vu')
    expect(slugify('  --  ')).toBe('')
  })
})

describe('uniqueSlug', () => {
  it('appends -2, -3, … to a slug already used, and records the result', () => {
    const used = new Set(['intro'])
    expect(uniqueSlug('intro', used)).toBe('intro-2')
    expect(uniqueSlug('intro', used)).toBe('intro-3')
    expect(used).toEqual(new Set(['intro', 'intro-2', 'intro-3']))
  })

  it('never gives a slug that a /read/<book>/ route uses', () => {
    expect(uniqueSlug('ask', new Set())).toBe('ask-2')
    expect(uniqueSlug('asking', new Set())).toBe('asking')
  })
})
