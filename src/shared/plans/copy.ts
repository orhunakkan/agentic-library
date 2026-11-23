import { FREE_LIMITS, type Plan, type PlanSource, PRO_LIMITS, type ProFeature } from './plans.ts'

export interface ProNoticeCopy {
  heading: string
  sentence: string
}

const NOTICES: Record<ProFeature, ProNoticeCopy> = {
  ask: {
    heading: 'Ask the book is part of Pro.',
    sentence:
      'Ask questions about the book and get answers that link to the pages they came from. It uses your own Anthropic key.',
  },
  translate: { heading: 'Translate is part of Pro.', sentence: 'Look up stays free.' },
  export: {
    heading: 'Markdown export is part of Pro.',
    sentence: 'Your highlights are always in Your data’s export.',
  },
  audiobooks: {
    heading: 'Uploading audiobooks is part of Pro.',
    sentence: 'EPUB, PDF and Markdown books import as usual.',
  },
  elevenlabs: {
    heading: 'ElevenLabs voices are part of Pro.',
    sentence: 'Your device’s voices and the Folio voice stay free.',
  },
  flashcards: {
    heading: 'Flashcards are part of Pro.',
    sentence: 'Your saved cards are kept, and you can delete them.',
  },
  run: {
    heading: 'Running code is part of Pro.',
    sentence: 'Edit and run a book’s JavaScript, TypeScript, Python and SQL examples on your device.',
  },
}

export function proNotice(feature: ProFeature): ProNoticeCopy {
  return NOTICES[feature]
}

export function bookQuotaCopy(plan: Plan, max: number): string {
  return plan === 'free'
    ? `Free includes ${max} of your own books. Delete one, or go Pro for up to ${PRO_LIMITS.books}.`
    : `You have ${max} of your own books. Delete one to import another.`
}

export function highlightQuotaCopy(plan: Plan, max: number): string {
  return plan === 'free'
    ? `Free includes ${max} highlights and notes. Delete some, or go Pro for unlimited.`
    : `You’ve reached ${max.toLocaleString('en-GB')} highlights.`
}

export type UsageKind = 'books' | 'highlights'

const USAGE_LABEL: Record<UsageKind, string> = { books: 'Your books', highlights: 'Highlights and notes' }
const USAGE_MORE: Record<UsageKind, string> = { books: 'import more', highlights: 'add more' }

export function usageLine(kind: UsageKind, used: number, max: number, plan: Plan): string {
  const line = `${USAGE_LABEL[kind]}: ${used} of ${max}`
  if (used < max) return line
  if (used === max) return `${line}. You’ve reached ${plan === 'free' ? 'Free' : 'Pro'}’s limit.`
  return plan === 'free'
    ? `${line}. You can keep them all; delete some, or go Pro, to ${USAGE_MORE[kind]}.`
    : `${line}. You can keep them all; delete some to ${USAGE_MORE[kind]}.`
}

export function planLine(source: PlanSource): { before: string; name: 'Free' | 'Pro'; after: string } {
  if (source === 'admin') return { before: 'You’re on ', name: 'Pro', after: ', as an admin.' }
  if (source === 'given') return { before: 'You’re on ', name: 'Pro', after: ', given by an admin.' }
  if (source === 'paid') return { before: 'You’re on ', name: 'Pro', after: '.' }
  return { before: 'You’re on ', name: 'Free', after: '.' }
}

export interface PaidLabel {
  cadence: 'month' | 'year'
  founding: boolean
  pastDue: boolean
}

export function planLabel(source: PlanSource, paid?: PaidLabel | null): string {
  if (source === 'admin') return 'Pro, admin'
  if (source === 'given') return 'Pro, given'
  if (source === 'paid') {
    if (!paid) return 'Pro, paid'
    if (paid.pastDue) return 'Pro, past due'
    if (paid.founding) return 'Pro, paid (founding)'
    return `Pro, paid (${paid.cadence === 'month' ? 'monthly' : 'yearly'})`
  }
  return 'Free'
}

export const NO_TRIAL = `There’s no trial. Free never runs out: it includes ${FREE_LIMITS.books} of your own books and ${FREE_LIMITS.highlights} highlights and notes. Pro removes those limits.`
