import { describe, expect, it } from 'vitest'
import { LOOKUP_PROBLEM_TEXT, matchesText, NO_MATCHES } from './lookup-problems'

describe('Find cover and details copy', () => {
  it('says each problem in plain words', () => {
    expect(LOOKUP_PROBLEM_TEXT).toEqual({
      rate: 'You’ve looked up 30 times in the last hour. Try again later.',
      busy: 'Open Library is busy. Try again in a moment.',
      unavailable: 'Open Library couldn’t be reached. Try again later.',
      'cover-too-large': 'That cover is too large to use. (The description is still applied.)',
      'cover-failed': 'That cover couldn’t be fetched. (The description is still applied.)',
      not_found: 'This book isn’t on your shelf any more.',
      signed_out: 'You’ve been signed out. Sign in and try again.',
      invalid: 'Enter a title or an ISBN.',
    })
  })

  it('counts the matches, and says what to try when there are none', () => {
    expect(NO_MATCHES).toBe('No matches on Open Library. Try fewer words, or the ISBN.')
    expect(matchesText(0)).toBe(NO_MATCHES)
    expect(matchesText(1)).toBe('1 match')
    expect(matchesText(5)).toBe('5 matches')
  })
})
