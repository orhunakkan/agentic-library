import { type ChangeResult, post, readAnswer } from '~/client/features/highlights/highlights-client'
import type { PagePosition } from '~/shared/content/position'
import type { FlashcardView } from '~/shared/flashcards/contract'
import type { CardOrigin } from '~/shared/flashcards/limits'
import type { ReviewResult } from '~/shared/flashcards/schedule'

export type FlashcardProblem = 'quota-book' | 'quota-user' | 'pro' | 'signed_out' | 'not_found' | 'failed'

export type FlashcardResult<T> = ChangeResult<T, FlashcardProblem>

async function send<T>(path: string, body: unknown, pick: (body: Record<string, unknown>) => T | undefined) {
  try {
    const result = await readAnswer(await post(path, body), pick)
    if (result.ok) return result
    const { problem } = result
    return { ok: false, problem: problem === 'stale' || problem === 'quota-free' ? 'failed' : problem } as const
  } catch {
    return { ok: false, problem: 'failed' } as const
  }
}

const cardOf = (body: Record<string, unknown>) =>
  body.card && typeof body.card === 'object' ? (body.card as FlashcardView) : undefined

export interface NewCardRequest {
  book: string
  front: string
  back: string
  position: PagePosition
  origin: CardOrigin
}

export function saveCard(request: NewCardRequest): Promise<FlashcardResult<{ card: FlashcardView; existed: boolean }>> {
  return send('/account/flashcards/new', request, (b) => {
    const card = cardOf(b)
    return card ? { card, existed: b.existed === true } : undefined
  })
}

export function reviewCard(id: string, review: ReviewResult): Promise<FlashcardResult<FlashcardView>> {
  return send(`/account/flashcards/${encodeURIComponent(id)}`, { review }, cardOf)
}

export function deleteCard(id: string): Promise<FlashcardResult<true>> {
  return send(`/account/flashcards/${encodeURIComponent(id)}`, { delete: true }, (b) =>
    b.deleted === true ? true : undefined,
  )
}
