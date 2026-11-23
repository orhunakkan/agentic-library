import {
  type AppliesTo,
  MAX_ASK_PROMPTS,
  PROMPT_INSTRUCTION_MAX,
  type PromptReason,
} from '~/shared/ask-prompts/prompts'
import { proNotice } from '~/shared/plans/copy'

export const PROMPTS_INTRO =
  'Your own requests for Ask the book, run from the Your prompts menu in the Ask panel. Each one is sent to Anthropic with the book’s text on your own key, as a question you type is.'

export const EMPTY_TEXT = 'You haven’t saved a prompt yet. Start from one of these, or write your own.'

export const FREE_KEPT_TEXT = 'Your saved prompts are kept. You can delete any you don’t need.'

export type PromptProblem =
  | Exclude<PromptReason, 'applies_to'>
  | 'exists'
  | 'quota'
  | 'not_found'
  | 'pro'
  | 'signed_out'
  | 'failed'

const format = (n: number) => n.toLocaleString('en-GB')

export function promptProblemText(problem: PromptProblem, name = ''): string {
  switch (problem) {
    case 'name_empty':
      return 'Give the prompt a name.'
    case 'name_too_long':
      return 'Keep the name to 60 characters.'
    case 'instruction_empty':
      return 'Write what the prompt should ask.'
    case 'instruction_too_long':
      return `Keep the prompt to ${format(PROMPT_INSTRUCTION_MAX)} characters.`
    case 'reserved':
      return 'A prompt can’t contain the text “<reader-prompt”.'
    case 'exists':
      return `You already have a prompt called “${name}”. Pick another name.`
    case 'quota':
      return `You have ${MAX_ASK_PROMPTS} prompts, the most an account can keep. Delete one to add another.`
    case 'not_found':
      return 'That prompt isn’t there any more. It may have been deleted on another device.'
    case 'pro':
      return proNotice('ask').heading
    case 'signed_out':
      return 'Sign in again to change your prompts.'
    case 'failed':
      return 'Couldn’t save the prompt. Try again.'
  }
}

export const countText = (n: number) => `${n} of ${MAX_ASK_PROMPTS} prompts`

export const COUNTER_FROM = 1_800
export const counterText = (n: number) => `${format(n)} of ${format(PROMPT_INSTRUCTION_MAX)}`

export const appliesToText = (appliesTo: AppliesTo) =>
  appliesTo === 'passage' ? 'On a passage you select' : 'On the pages you’ve read'

export const APPLIES_TO_CHOICES: readonly { value: AppliesTo; label: string; hint: string }[] = [
  {
    value: 'pages',
    label: 'The pages I’ve read',
    hint: 'Like Summarise: the book up to your page, or the whole book with the switch on.',
  },
  { value: 'passage', label: 'A passage I select', hint: 'Like Explain: shows after Ask about this on a passage.' },
]

export type PromptStatus = 'saved' | 'deleted' | 'moved-up' | 'moved-down'

export function statusText(status: PromptStatus, name: string): string {
  switch (status) {
    case 'saved':
      return `Saved “${name}”.`
    case 'deleted':
      return `Deleted “${name}”.`
    case 'moved-up':
      return `Moved “${name}” up.`
    case 'moved-down':
      return `Moved “${name}” down.`
  }
}

export const deleteQuestion = (name: string) => `Delete the prompt “${name}”? Nothing else changes.`

export const moveLabel = (name: string, direction: 'up' | 'down') => `Move “${name}” ${direction}`
