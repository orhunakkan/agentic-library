export const AI_MODELS = [
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    description: 'The most capable. A first question on a long book costs about $1–2, follow-ups a few cents.',
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    description: 'Quick and capable, about half the cost of Opus: $0.60–1 for a first question on a long book.',
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    description: 'The fastest and cheapest: about $0.25 for a first question on a long book, a cent after that.',
  },
] as const

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
