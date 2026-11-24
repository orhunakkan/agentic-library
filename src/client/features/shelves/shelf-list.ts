import type { ShelfView } from '~/shared/shelves/contract'
import { MAX_SHELF_BOOKS_PER_USER, MAX_SHELVES_PER_USER, shelfNameKey } from '~/shared/shelves/shelves'
import type { ShelfProblem } from './shelves-client'

const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export const sortShelves = <S extends ShelfView>(shelves: readonly S[]): S[] =>
  [...shelves].sort((a, b) => byName.compare(a.name, b.name))

/** The shelf with the book put first on it, without a second copy, or taken off. */
export function withBook(shelf: ShelfView, slug: string, on: boolean): ShelfView {
  const rest = shelf.books.filter((b) => b !== slug)
  return { ...shelf, books: on ? [slug, ...rest] : rest }
}

export function findByName<S extends ShelfView>(shelves: readonly S[], name: string): S | undefined {
  const key = shelfNameKey(name)
  return key ? shelves.find((s) => shelfNameKey(s.name) === key) : undefined
}

export type ShelfButton = { kind: 'none' } | { kind: 'one'; name: string } | { kind: 'many'; count: number }

export function shelfButton(shelves: readonly ShelfView[] | null, slug: string): ShelfButton {
  const on = (shelves ?? []).filter((s) => s.books.includes(slug))
  if (on.length === 0) return { kind: 'none' }
  if (on.length === 1) return { kind: 'one', name: (on[0] as ShelfView).name }
  return { kind: 'many', count: on.length }
}

export function problemText(problem: ShelfProblem, context: { name?: string; book?: boolean } = {}): string {
  switch (problem) {
    case 'duplicate':
      return context.name
        ? `You already have a shelf called “${context.name}”.`
        : 'You already have a shelf by that name.'
    case 'limit_shelves':
      return `You can have up to ${MAX_SHELVES_PER_USER} shelves.`
    case 'limit_books':
      return `Your shelves can hold up to ${MAX_SHELF_BOOKS_PER_USER.toLocaleString('en-GB')} books in all.`
    case 'not_found':
      return context.book ? 'This book is no longer available.' : 'That shelf was deleted on another device.'
    case 'signed_out':
      return 'Your session ended.'
    default:
      return 'Couldn’t save that. Try again.'
  }
}
