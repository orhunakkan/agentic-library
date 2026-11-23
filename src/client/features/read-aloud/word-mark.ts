export type WordSpan = { start: number; end: number } | null

export interface WordMark {
  set: (span: WordSpan) => void
  get: () => WordSpan
  subscribe: (listener: (span: WordSpan) => void) => () => void
}

export function createWordMark(): WordMark {
  let span: WordSpan = null
  const listeners = new Set<(span: WordSpan) => void>()
  return {
    set: (next) => {
      if (next === span || (next && span && next.start === span.start && next.end === span.end)) return
      span = next
      for (const listener of listeners) listener(span)
    },
    get: () => span,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const wordMark = createWordMark()
