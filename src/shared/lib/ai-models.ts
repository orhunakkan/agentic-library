export type AiProvider = 'anthropic' | 'openai'

interface ProviderTraits {
  name: string
  /** The family name its models go by in messages, such as "Claude couldn’t answer that". */
  family: string
  /** Whether answers can cite the book's pages. Quizzes and flashcards need it: their source pages are citations. */
  citations: boolean
}

export const AI_PROVIDERS: Record<AiProvider, ProviderTraits> = {
  anthropic: { name: 'Anthropic', family: 'Claude', citations: true },
  openai: { name: 'OpenAI', family: 'GPT', citations: false },
}

/**
 * GPT costs assume OpenAI's standard rates for a first question that sends 200–400K tokens of a long book, the same
 * book the Claude lines describe; follow-ups reuse OpenAI's prompt cache.
 */
export const AI_MODELS = [
  {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    name: 'Claude Opus 5.5',
    description: 'The most capable. A first question on a long book costs about $1–2, follow-ups a few cents.',
  },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    name: 'Claude Sonnet 5.5',
    description: 'Quick and capable, about half the cost of Opus: $0.60–1 for a first question on a long book.',
  },
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    name: 'Claude Haiku 5.5',
    description: 'The fastest and cheapest: about $0.25 for a first question on a long book, a cent after that.',
  },
  {
    id: 'gpt-6.2-astra',
    provider: 'openai',
    name: 'GPT-6.2 Astra',
    description: 'OpenAI’s most capable. A first question on a long book costs about $2–6, follow-ups about 10 cents.',
  },
  {
    id: 'gpt-6.1-terra',
    provider: 'openai',
    name: 'GPT-6.1 Terra',
    description: 'Fast and efficient: about $0.20–0.80 for a first question on a long book, a cent or two after that.',
  },
  {
    id: 'gpt-6-luna',
    provider: 'openai',
    name: 'GPT-6 Luna',
    description: 'OpenAI’s fastest and cheapest: a few cents for a first question on a long book.',
  },
] as const satisfies readonly { id: string; provider: AiProvider; name: string; description: string }[]

export type AiModelId = (typeof AI_MODELS)[number]['id']

export const DEFAULT_AI_MODEL: AiModelId = 'claude-opus-5-5'

export function isAiModel(value: unknown): value is AiModelId {
  return AI_MODELS.some((m) => m.id === value)
}

export function resolveAiModel(stored: string | null | undefined): AiModelId {
  return isAiModel(stored) ? stored : DEFAULT_AI_MODEL
}

export function aiModelName(id: AiModelId): string {
  return AI_MODELS.find((m) => m.id === id)?.name ?? id
}

export const providerOf = (id: AiModelId): AiProvider => AI_MODELS.find((m) => m.id === id)?.provider ?? 'anthropic'

export const providerName = (provider: AiProvider): string => AI_PROVIDERS[provider].name

/** Whether quizzes and flashcards can be made with this model. */
export const canStudyWith = (id: AiModelId): boolean => AI_PROVIDERS[providerOf(id)].citations
