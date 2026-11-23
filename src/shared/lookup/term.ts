export const TERM_MAX = 60
export const TERM_WORDS = 3
export const PASSAGE_MAX = 1_000

export const collapse = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim()

const length = (text: string) => [...text].length

export function lookupTerm(text: string): string | null {
  const term = collapse(text)
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
    .replace(/['’]s$/u, '')
  if (!term || length(term) > TERM_MAX) return null
  if (term.split(' ').length > TERM_WORDS) return null
  return /\p{L}/u.test(term) ? term : null
}

export function selectionKind(text: string): 'term' | 'passage' | null {
  if (lookupTerm(text)) return 'term'
  const passage = collapse(text)
  return passage && length(passage) <= PASSAGE_MAX ? 'passage' : null
}
