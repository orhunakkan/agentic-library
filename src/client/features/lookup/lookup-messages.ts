import { AI_PROVIDERS, type AiProvider } from '~/shared/lib/ai-models'
import type { WordSource } from '~/shared/lookup/contract'
import type { TranslateProblem, WordProblem } from './lookup-client'

export const SOURCE_NAME: Record<WordSource, string> = { dictionary: 'Wiktionary', wikipedia: 'Wikipedia' }

export const SIGNED_OUT_TEXT = 'Sign in to look up words and translate passages.'
const named = (provider: AiProvider) => AI_PROVIDERS[provider].name

export const noKeyText = (provider: AiProvider = 'anthropic') => `Translating uses your own ${named(provider)} key.`

export const translatedByText = (model: string, provider: AiProvider) =>
  `Translated by ${model} with your ${named(provider)} key.`

export const translatePrivacyText = (provider: AiProvider) =>
  `The text and the sentence around it go to ${named(provider)} with your key. The book doesn’t.`

export const explainUsesText = (provider: AiProvider) => `Uses Ask with your ${named(provider)} key.`

export const noEntryText = (term: string) => `Wiktionary has no entry for “${term}”.`
export const NO_ENTRY_HINT = 'Try the Wikipedia tab or Explain in context.'
export const noArticleText = (term: string) => `Wikipedia has no article called “${term}”.`
export const ambiguousText = (title: string) => `“${title}” can mean several things on Wikipedia.`

export const otherLanguageText = (bookLanguage: string, entryLanguage: string) =>
  `No ${bookLanguage} entry. From the ${entryLanguage} entries:`

export const keyRejected = (provider: AiProvider = 'anthropic') => ({
  before: `${named(provider)} rejected your key. Check it on the `,
  link: 'API keys page',
  after: '.',
})

export interface Notice {
  text: string
  retry: boolean
}

export const clock = (at: Date) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(at)

function shared(problem: WordProblem | TranslateProblem, retryAt: Date | undefined, limitText: string): Notice | null {
  if (problem === 'not_found') return { text: 'This book is no longer available.', retry: false }
  if (problem === 'rate')
    return {
      text: retryAt ? `${limitText} Try again at ${clock(retryAt)}.` : `${limitText} Try again later.`,
      retry: false,
    }
  return null
}

export function wordNotice(source: WordSource, problem: Exclude<WordProblem, 'signed_out'>, retryAt?: Date): Notice {
  const common = shared(problem, retryAt, 'You’ve looked up 300 words this hour.')
  if (common) return common
  if (problem === 'busy') return { text: `${SOURCE_NAME[source]} is busy. Try again in a moment.`, retry: true }
  return { text: `Couldn’t reach ${SOURCE_NAME[source]}.`, retry: true }
}

export function translateNotice(
  problem: Exclude<TranslateProblem, 'signed_out' | 'pro' | 'no_key' | 'key_rejected'>,
  retryAt?: Date,
  provider: AiProvider = 'anthropic',
): Notice {
  const common = shared(problem, retryAt, 'You’ve translated 120 times this hour.')
  if (common) return common
  switch (problem) {
    case 'billing':
      return { text: `Your ${named(provider)} account needs credit.`, retry: false }
    case 'busy':
      return { text: `${named(provider)} is busy. Try again in a moment.`, retry: true }
    case 'refused':
      return { text: `${AI_PROVIDERS[provider].family} didn’t translate this.`, retry: false }
    default:
      return { text: 'Couldn’t translate that.', retry: true }
  }
}
