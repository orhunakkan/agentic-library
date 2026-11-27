import { describe, expect, it } from 'vitest'
import { primaryButton, secondaryButton } from '~/client/features/home/buttons'

describe('the home page buttons', () => {
  it('fill the primary with lime and always pair it with dark text, as the design requires', () => {
    for (const size of ['compact', 'large'] as const) {
      expect(primaryButton(size)).toContain('bg-accent-fill')
      expect(primaryButton(size)).toContain('text-on-accent')
    }
  })

  it('outline the secondary on the surface, in ink', () => {
    expect(secondaryButton()).toContain('border-line')
    expect(secondaryButton()).toContain('text-ink')
    expect(secondaryButton()).not.toContain('bg-accent-fill')
  })

  it('make the large size the default and the compact one smaller on a phone', () => {
    expect(primaryButton()).toBe(primaryButton('large'))
    expect(primaryButton('compact')).toContain('h-10')
    expect(primaryButton('compact')).toContain('sm:h-11')
  })
})
