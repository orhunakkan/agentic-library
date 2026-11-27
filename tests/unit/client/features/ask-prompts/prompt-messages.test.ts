import { describe, expect, it } from 'vitest'
import {
  appliesToText,
  counterText,
  countText,
  deleteQuestion,
  moveLabel,
  type PromptProblem,
  promptProblemText,
  statusText,
} from '~/client/features/ask-prompts/prompt-messages'

describe('promptProblemText', () => {
  it('has the sentence for every code', () => {
    const sentences: Record<PromptProblem, string> = {
      name_empty: 'Give the prompt a name.',
      name_too_long: 'Keep the name to 60 characters.',
      instruction_empty: 'Write what the prompt should ask.',
      instruction_too_long: 'Keep the prompt to 2,000 characters.',
      reserved: 'A prompt can’t contain the text “<reader-prompt”.',
      exists: 'You already have a prompt called “Recap”. Pick another name.',
      quota: 'You have 20 prompts, the most an account can keep. Delete one to add another.',
      not_found: 'That prompt isn’t there any more. It may have been deleted on another device.',
      signed_out: 'Sign in again to change your prompts.',
      failed: 'Couldn’t save the prompt. Try again.',
    }
    for (const [code, sentence] of Object.entries(sentences)) {
      const text = promptProblemText(code as PromptProblem, 'Recap')
      expect(text).toBe(sentence)
    }
  })
})

describe('the page’s lines', () => {
  it('counts, labels and reports', () => {
    expect(countText(3)).toBe('3 of 20 prompts')
    expect(counterText(1850)).toBe('1,850 of 2,000')
    expect(appliesToText('pages')).toBe('On the pages you’ve read')
    expect(appliesToText('passage')).toBe('On a passage you select')
    expect(statusText('saved', 'A')).toBe('Saved “A”.')
    expect(statusText('deleted', 'A')).toBe('Deleted “A”.')
    expect(statusText('moved-up', 'A')).toBe('Moved “A” up.')
    expect(statusText('moved-down', 'A')).toBe('Moved “A” down.')
    expect(deleteQuestion('A')).toBe('Delete the prompt “A”? Nothing else changes.')
    expect(moveLabel('A', 'up')).toBe('Move “A” up')
  })
})
