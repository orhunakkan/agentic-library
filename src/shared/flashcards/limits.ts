export const MAX_CARDS_PER_BOOK = 1_000
export const MAX_CARDS_PER_USER = 10_000
export const FRONT_MAX = 200
export const BACK_MAX = 500
export const REVIEW_SESSION_MAX = 20
export const CARD_ORIGINS = ['quiz', 'flashcards'] as const
export type CardOrigin = (typeof CARD_ORIGINS)[number]
