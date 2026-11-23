import { describe, expect, it } from 'vitest'
import {
  ambiguousText,
  KEY_REJECTED,
  NO_ENTRY_HINT,
  NO_KEY_TEXT,
  noArticleText,
  noEntryText,
  otherLanguageText,
  SIGNED_OUT_TEXT,
  translateNotice,
  wordNotice,
} from './lookup-messages'

const AT = new Date(2026, 10, 9, 14, 5)

describe('the card without an answer', () => {
  it('says why when signed out or without a key', () => {
    expect(SIGNED_OUT_TEXT).toBe('Sign in to look up words and translate passages.')
    expect(NO_KEY_TEXT).toBe('Translating uses your own Anthropic key.')
  })

  it('says there is no entry, no article or several meanings', () => {
    expect(noEntryText('Bingley')).toBe('Wiktionary has no entry for “Bingley”.')
    expect(NO_ENTRY_HINT).toBe('Try the Wikipedia tab or Explain in context.')
    expect(noArticleText('Bingley')).toBe('Wikipedia has no article called “Bingley”.')
    expect(ambiguousText('Netherfield')).toBe('“Netherfield” can mean several things on Wikipedia.')
    expect(otherLanguageText('English', 'French')).toBe('No English entry. From the French entries:')
  })

  it('words a rejected key around its link', () => {
    expect(`${KEY_REJECTED.before}${KEY_REJECTED.link}${KEY_REJECTED.after}`).toBe(
      'Anthropic rejected your key. Check it on the API keys page.',
    )
  })
})

describe('wordNotice', () => {
  it('names the source when it is busy or out of reach, with Retry', () => {
    expect(wordNotice('dictionary', 'busy')).toEqual({
      text: 'Wiktionary is busy. Try again in a moment.',
      retry: true,
    })
    expect(wordNotice('wikipedia', 'busy')).toEqual({ text: 'Wikipedia is busy. Try again in a moment.', retry: true })
    for (const problem of ['unavailable', 'network', 'failed'] as const) {
      expect(wordNotice('dictionary', problem)).toEqual({ text: 'Couldn’t reach Wiktionary.', retry: true })
      expect(wordNotice('wikipedia', problem)).toEqual({ text: 'Couldn’t reach Wikipedia.', retry: true })
    }
  })

  it('gives the hourly limit with when it lifts, and a removed book, without Retry', () => {
    expect(wordNotice('dictionary', 'rate', AT)).toEqual({
      text: 'You’ve looked up 300 words this hour. Try again at 14:05.',
      retry: false,
    })
    expect(wordNotice('dictionary', 'rate')).toEqual({
      text: 'You’ve looked up 300 words this hour. Try again later.',
      retry: false,
    })
    expect(wordNotice('wikipedia', 'not_found')).toEqual({ text: 'This book is no longer available.', retry: false })
  })
})

describe('translateNotice', () => {
  it('words each failure, with Retry only where trying again can help', () => {
    expect(translateNotice('rate', AT)).toEqual({
      text: 'You’ve translated 120 times this hour. Try again at 14:05.',
      retry: false,
    })
    expect(translateNotice('rate')).toEqual({
      text: 'You’ve translated 120 times this hour. Try again later.',
      retry: false,
    })
    expect(translateNotice('not_found')).toEqual({ text: 'This book is no longer available.', retry: false })
    expect(translateNotice('billing')).toEqual({ text: 'Your Anthropic account needs credit.', retry: false })
    expect(translateNotice('busy')).toEqual({ text: 'Anthropic is busy. Try again in a moment.', retry: true })
    expect(translateNotice('refused')).toEqual({ text: 'Claude didn’t translate this.', retry: false })
    expect(translateNotice('network')).toEqual({ text: 'Couldn’t translate that.', retry: true })
    expect(translateNotice('failed')).toEqual({ text: 'Couldn’t translate that.', retry: true })
  })
})
