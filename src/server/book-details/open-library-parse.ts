import { cleanDescription } from '../../shared/import/details.ts'
import { isObject } from '../../shared/lib/json-shape.ts'
import { WORK_ID } from './input.ts'

export interface OpenLibraryMatch {
  work: string
  title: string
  author: string | null
  year: number | null
  coverId: number | null
}

export const MAX_MATCHES = 5

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null

const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null

export function parseSearch(json: unknown): OpenLibraryMatch[] {
  const docs = isObject(json) && Array.isArray(json.docs) ? json.docs : []
  const matches: OpenLibraryMatch[] = []
  for (const doc of docs) {
    if (matches.length >= MAX_MATCHES) break
    if (!isObject(doc) || typeof doc.key !== 'string') continue
    const work = doc.key.replace(/^\/works\//, '')
    const title = text(doc.title, 300)
    if (!WORK_ID.test(work) || !title) continue
    const authors = Array.isArray(doc.author_name) ? doc.author_name : []
    const year = positive(doc.first_publish_year)
    matches.push({
      work,
      title,
      author: text(authors[0], 200),
      year: year && year <= 9999 ? year : null,
      coverId: positive(doc.cover_i),
    })
  }
  return matches
}

export function parseWork(json: unknown): { description: string | null } {
  if (!isObject(json)) return { description: null }
  const raw = json.description
  const value = typeof raw === 'string' ? raw : isObject(raw) && typeof raw.value === 'string' ? raw.value : null
  return { description: cleanDescription(value) }
}
