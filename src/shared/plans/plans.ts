import { FREE_ARTICLES, PRO_ARTICLES } from '../articles/contract.ts'
import { MAX_HIGHLIGHTS_PER_BOOK, MAX_HIGHLIGHTS_PER_USER } from '../highlights/limits.ts'
import { MAX_BOOKS } from '../import/limits.ts'
import { isOneOf } from '../lib/json-shape.ts'

export type Plan = 'free' | 'pro'

export type PlanSource = 'admin' | 'paid' | 'given' | 'free'

export const PRO_FEATURE_NAMES = [
  'ask',
  'translate',
  'export',
  'audiobooks',
  'elevenlabs',
  'flashcards',
  'run',
] as const
export type ProFeature = (typeof PRO_FEATURE_NAMES)[number]

export const DEVICE_FEATURES = ['run'] as const satisfies readonly ProFeature[]
export type DeviceFeature = (typeof DEVICE_FEATURES)[number]

export const FREE_LIMITS = { books: 2, highlights: 50, articles: FREE_ARTICLES } as const

export const PRO_LIMITS = {
  books: MAX_BOOKS,
  highlightsPerBook: MAX_HIGHLIGHTS_PER_BOOK,
  highlightsPerUser: MAX_HIGHLIGHTS_PER_USER,
  articles: PRO_ARTICLES,
} as const

export interface Limits {
  books: number
  highlightsPerBook: number
  highlightsPerUser: number
  articles: number
}

export function limitsFor(plan: Plan): Limits {
  if (plan === 'pro') return { ...PRO_LIMITS }
  return {
    books: FREE_LIMITS.books,
    highlightsPerBook: FREE_LIMITS.highlights,
    highlightsPerUser: FREE_LIMITS.highlights,
    articles: FREE_LIMITS.articles,
  }
}

export function canUse(plan: Plan, _feature: ProFeature): boolean {
  return plan === 'pro'
}

export const PRO_FEATURES: readonly { feature?: ProFeature; label: string }[] = [
  { feature: 'ask', label: 'Ask the book, with your own Anthropic or OpenAI key' },
  { feature: 'translate', label: 'Translate and Explain in context' },
  { label: `Up to ${PRO_LIMITS.books} of your own books` },
  { label: 'Unlimited highlights and notes' },
  { label: `Save up to ${PRO_LIMITS.articles} articles` },
  { feature: 'export', label: 'Export your notes as Markdown' },
  { feature: 'audiobooks', label: 'Upload your own audiobooks' },
  { feature: 'elevenlabs', label: 'ElevenLabs voices, with your own key' },
  { feature: 'flashcards', label: 'Flashcards' },
  { feature: 'run', label: 'Run the code examples in your books' },
]

export const PRO_LINK = '/account/plan'

export function isPlan(value: unknown): value is Plan {
  return value === 'free' || value === 'pro'
}

export function isProFeature(value: unknown): value is ProFeature {
  return isOneOf(value, PRO_FEATURE_NAMES)
}
