import { proNotice } from '~/shared/plans/copy'
import type { AskAction, AskProblem } from './ask-client'

export const PROBLEM_TEXT: Record<AskProblem, string> = {
  signed_out: 'Sign in and add an Anthropic API key to ask questions about this book.',
  pro: proNotice('ask').heading,
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
}

const RETRYABLE: readonly AskProblem[] = ['busy', 'bad_format', 'failed']

export const canRetry = (problem: AskProblem) => RETRYABLE.includes(problem)

export function failureText(problem: AskProblem, retryAt?: string, action?: AskAction | null): string {
  if (problem === 'bad_format' && action === 'flashcards')
    return 'The answer didn’t come back as flashcards. Try again.'
  const text = PROBLEM_TEXT[problem]
  if (problem !== 'limit' || !retryAt) return text
  const time = new Date(retryAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${text} Try again at ${time}.`
}
