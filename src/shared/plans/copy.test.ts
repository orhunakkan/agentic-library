import { describe, expect, it } from 'vitest'
import { bookQuotaCopy, highlightQuotaCopy, NO_TRIAL, planLabel, planLine, proNotice, usageLine } from './copy.ts'
import { PRO_FEATURE_NAMES } from './plans.ts'

describe('the plans’ copy', () => {
  it('has a notice for every Pro feature', () => {
    expect(proNotice('ask')).toEqual({
      heading: 'Ask the book is part of Pro.',
      sentence:
        'Ask questions about the book and get answers that link to the pages they came from. It uses your own Anthropic or OpenAI key.',
    })
    expect(proNotice('translate')).toEqual({ heading: 'Translate is part of Pro.', sentence: 'Look up stays free.' })
    expect(proNotice('export').heading).toBe('Markdown export is part of Pro.')
    expect(proNotice('export').sentence).toBe('Your highlights are always in Your data’s export.')
    expect(proNotice('audiobooks').heading).toBe('Uploading audiobooks is part of Pro.')
    expect(proNotice('elevenlabs').heading).toBe('ElevenLabs voices are part of Pro.')
    expect(proNotice('flashcards').heading).toBe('Flashcards are part of Pro.')
    expect(proNotice('run')).toEqual({
      heading: 'Running code is part of Pro.',
      sentence: 'Edit and run a book’s JavaScript, TypeScript, Python and SQL examples on your device.',
    })
    for (const feature of PRO_FEATURE_NAMES) expect(proNotice(feature).sentence).toMatch(/\.$/)
  })

  it('says each plan’s book limit', () => {
    expect(bookQuotaCopy('free', 2)).toBe('Free includes 2 of your own books. Delete one, or go Pro for up to 25.')
    expect(bookQuotaCopy('pro', 25)).toBe('You have 25 of your own books. Delete one to import another.')
  })

  it('says each plan’s highlight limit', () => {
    expect(highlightQuotaCopy('free', 50)).toBe(
      'Free includes 50 highlights and notes. Delete some, or go Pro for unlimited.',
    )
    expect(highlightQuotaCopy('pro', 10_000)).toBe('You’ve reached 10,000 highlights.')
  })

  it('counts usage under, at and over the limit', () => {
    expect(usageLine('books', 1, 2, 'free')).toBe('Your books: 1 of 2')
    expect(usageLine('highlights', 12, 50, 'free')).toBe('Highlights and notes: 12 of 50')
    expect(usageLine('books', 2, 2, 'free')).toBe('Your books: 2 of 2. You’ve reached Free’s limit.')
    expect(usageLine('books', 25, 25, 'pro')).toBe('Your books: 25 of 25. You’ve reached Pro’s limit.')
    expect(usageLine('books', 7, 2, 'free')).toBe(
      'Your books: 7 of 2. You can keep them all; delete some, or go Pro, to import more.',
    )
    expect(usageLine('highlights', 60, 50, 'free')).toBe(
      'Highlights and notes: 60 of 50. You can keep them all; delete some, or go Pro, to add more.',
    )
    expect(usageLine('books', 26, 25, 'pro')).toBe(
      'Your books: 26 of 25. You can keep them all; delete some to import more.',
    )
  })

  it('says which plan the account is on, and why', () => {
    const whole = (source: Parameters<typeof planLine>[0]) => {
      const line = planLine(source)
      return `${line.before}${line.name}${line.after}`
    }
    expect(whole('free')).toBe('You’re on Free.')
    expect(whole('given')).toBe('You’re on Pro, given by an admin.')
    expect(whole('admin')).toBe('You’re on Pro, as an admin.')
    expect(whole('paid')).toBe('You’re on Pro.')
  })

  it('labels each plan for the Users page', () => {
    expect([planLabel('free'), planLabel('given'), planLabel('admin')]).toEqual(['Free', 'Pro, given', 'Pro, admin'])
    const paid = (cadence: 'month' | 'year', founding = false, pastDue = false) =>
      planLabel('paid', { cadence, founding, pastDue })
    expect([paid('month'), paid('year'), paid('year', true), paid('month', false, true)]).toEqual([
      'Pro, paid (monthly)',
      'Pro, paid (yearly)',
      'Pro, paid (founding)',
      'Pro, past due',
    ])
    expect(planLabel('paid')).toBe('Pro, paid')
  })

  it('answers the free trial, with no starter book', async () => {
    expect(NO_TRIAL).toBe(
      'There’s no trial. Free never runs out: it includes 2 of your own books and 50 highlights and notes. Pro removes those limits.',
    )
    expect(Object.keys(await import('./copy.ts'))).not.toContain('STARTER_NOTE')
  })
})
