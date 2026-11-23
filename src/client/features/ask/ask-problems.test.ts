import { describe, expect, it } from 'vitest'
import type { AskProblem } from './ask-client'
import { canRetry, failureText, PROBLEM_TEXT } from './ask-problems'

describe('PROBLEM_TEXT', () => {
  it('says each reason there is no answer in plain words', () => {
    expect(PROBLEM_TEXT).toEqual({
      signed_out: 'Sign in and add an Anthropic API key to ask questions about this book.',
      pro: 'Ask the book is part of Pro.',
      no_key: 'Add an Anthropic API key to ask questions.',
      not_found: 'Couldn’t get an answer. Try again.',
      no_prompt: 'That prompt isn’t there any more. It may have been deleted on another device.',
      invalid: 'Couldn’t get an answer. Try again.',
      too_little: 'Read a little further first: there isn’t enough on these pages yet to make questions from.',
      limit: 'You’ve asked a lot this hour.',
      too_long: 'This book is too long for Ask for now.',
      key_rejected: 'Anthropic rejected your API key. Update it on the API keys page.',
      billing: 'Anthropic couldn’t bill your account. Check your plan or credits in the Claude Console.',
      busy: 'Anthropic is busy. Try again in a moment.',
      bad_format: 'The answer didn’t come back as a quiz. Try again.',
      refusal: 'Claude couldn’t answer that question.',
      failed: 'Couldn’t get an answer. Try again.',
    })
  })
})

describe('canRetry', () => {
  it('offers Retry only for a busy Anthropic, a bad format and a failed request; not for too little read', () => {
    const retryable = (Object.keys(PROBLEM_TEXT) as AskProblem[]).filter(canRetry)
    expect(retryable).toEqual(['busy', 'bad_format', 'failed'])
    expect(canRetry('too_little')).toBe(false)
    expect(canRetry('no_prompt')).toBe(false)
  })
})

describe('failureText', () => {
  it('adds when asking works again to the hourly limit', () => {
    const at = new Date(2026, 10, 9, 14, 5).toISOString()
    expect(failureText('limit', at)).toBe('You’ve asked a lot this hour. Try again at 14:05.')
    expect(failureText('limit')).toBe('You’ve asked a lot this hour.')
  })

  it('is the problem’s own sentence otherwise', () => {
    expect(failureText('busy', new Date().toISOString())).toBe('Anthropic is busy. Try again in a moment.')
    expect(failureText('key_rejected')).toBe('Anthropic rejected your API key. Update it on the API keys page.')
  })

  it('says which kind of answer came back in the wrong format', () => {
    expect(failureText('bad_format', undefined, 'quiz')).toBe('The answer didn’t come back as a quiz. Try again.')
    expect(failureText('bad_format', undefined, 'flashcards')).toBe(
      'The answer didn’t come back as flashcards. Try again.',
    )
    expect(failureText('too_little', undefined, 'flashcards')).toBe(
      'Read a little further first: there isn’t enough on these pages yet to make questions from.',
    )
  })
})
