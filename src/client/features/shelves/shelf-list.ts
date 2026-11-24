import type { ShelfView } from '~/shared/shelves/contract'
import { MAX_SHELF_BOOKS_PER_USER, MAX_SHELVES_PER_USER, shelfNameKey } from '~/shared/shelves/shelves'
import type { ShelfProblem } from './shelves-client'

const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export const sortShelves = (shelves: readonly ShelfView[]): ShelfView[] =>
  [...shelves].sort((a, b) => byName.compare(a.name, b.name))

export function withBook(shelves: readonly ShelfView[], id: string, slug: string, on: boolean): ShelfView[] {
  return shelves.map((s) => {
    if (s.id !== id) return s
    const rest = s.books.filter((b) => b !== slug)
    return { ...s, books: on ? [slug, ...rest] : rest }
  })
}

export const renamed = (shelves: readonly ShelfView[], id: string, name: string): ShelfView[] =>
  sortShelves(shelves.map((s) => (s.id === id ? { ...s, name } : s)))

export const removed = (shelves: readonly ShelfView[], id: string): ShelfView[] => shelves.filter((s) => s.id !== id)

export const PENDING_PREFIX = 'pending-'

export const isPending = (id: string) => id.startsWith(PENDING_PREFIX)

export const withPending = (shelves: readonly ShelfView[], tempId: string, name: string, slug: string): ShelfView[] =>
  sortShelves([...shelves, { id: tempId, name, books: [slug] }])

export const confirmed = (shelves: readonly ShelfView[], tempId: string, shelf: ShelfView): ShelfView[] =>
  sortShelves(shelves.map((s) => (s.id === tempId ? shelf : s)))

export function findByName(shelves: readonly ShelfView[], name: string): ShelfView | undefined {
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
