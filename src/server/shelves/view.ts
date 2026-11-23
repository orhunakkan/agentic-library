import '@tanstack/react-start/server-only'
import type { ShelfView } from '~/shared/shelves/contract'
import { slugOf } from '../book-ref/ref.ts'
import type { ShelfRow } from './store.ts'

const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export type Catalogue = { has(slug: string): boolean }

export function toShelfView(row: ShelfRow, catalogueSlugs: Catalogue): ShelfView {
  return {
    id: row.id,
    name: row.name,
    books: row.books.filter((b) => b.slug === null || catalogueSlugs.has(b.slug)).map(slugOf),
  }
}

export function toShelfViews(rows: readonly ShelfRow[], catalogueSlugs: Catalogue): ShelfView[] {
  return rows.map((row) => toShelfView(row, catalogueSlugs)).sort((a, b) => byName.compare(a.name, b.name))
}
