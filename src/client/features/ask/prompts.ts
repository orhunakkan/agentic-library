import type { AskPromptChoice } from '~/shared/ask-prompts/prompts'

export function promptsFor(prompts: readonly AskPromptChoice[], hasQuote: boolean): AskPromptChoice[] {
  return prompts.filter((p) => p.appliesTo === (hasQuote ? 'passage' : 'pages'))
}

export const menuHeading = (hasQuote: boolean) => (hasQuote ? 'For this passage' : 'For the pages you’ve read')

export const PROMPTS_HINT = 'Save your own prompts, like “Explain like I’m new”, to run here.'
