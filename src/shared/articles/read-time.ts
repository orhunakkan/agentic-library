export const WORDS_PER_MINUTE = 230

export function minutesFor(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

export const readTimeText = (words: number) => `${minutesFor(words)} min read`
