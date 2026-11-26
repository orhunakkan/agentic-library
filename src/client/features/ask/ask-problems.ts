import { timeOfDay } from '~/client/lib/format'
import type { AiProvider } from '~/shared/lib/ai-models'
import type { AskAction, AskProblem } from './ask-client'

/** Why the Quiz and Flashcards actions are off with a GPT model: their questions link to pages through citations. */
export const NEEDS_CLAUDE_TEXT = 'Quizzes and flashcards need a Claude model, so they can link each one to its page.'

export const PROBLEM_TEXT: Record<AskProblem, string> = {
  signed_out: 'Sign in and add an Anthropic API key to ask questions about this book.',
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
  needs_claude: `${NEEDS_CLAUDE_TEXT} Choose one on the API keys page.`,
  failed: 'Couldn’t get an answer. Try again.',
}

/** What changes when the question went to OpenAI: every sentence that names the provider or its models. */
const OPENAI_TEXT: Partial<Record<AskProblem, string>> = {
  signed_out: 'Sign in and add an OpenAI API key to ask questions about this book.',
  no_key: 'Add an OpenAI API key to ask questions with a GPT model.',
  too_long: 'This book is too long for Ask on OpenAI for now.',
  key_rejected: 'OpenAI rejected your API key. Update it on the API keys page.',
  billing: 'OpenAI couldn’t bill your account. Check your billing and credits on the OpenAI platform.',
  busy: 'OpenAI is busy. Try again in a moment.',
  refusal: 'GPT couldn’t answer that question.',
}

const PROVIDER_TEXT: Record<AiProvider, Partial<Record<AskProblem, string>>> = { anthropic: {}, openai: OPENAI_TEXT }

export function problemText(problem: AskProblem, provider: AiProvider = 'anthropic'): string {
  return PROVIDER_TEXT[provider][problem] ?? PROBLEM_TEXT[problem]
}

const RETRYABLE: readonly AskProblem[] = ['busy', 'bad_format', 'failed']

export const canRetry = (problem: AskProblem) => RETRYABLE.includes(problem)

export function failureText(
  problem: AskProblem,
  retryAt?: string,
  action?: AskAction | null,
  provider: AiProvider = 'anthropic',
): string {
  if (problem === 'bad_format' && action === 'flashcards')
    return 'The answer didn’t come back as flashcards. Try again.'
  const text = problemText(problem, provider)
  if (problem !== 'limit' || !retryAt) return text
  return `${text} Try again at ${timeOfDay(retryAt)}.`
}
