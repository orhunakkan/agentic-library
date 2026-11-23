import { cleanText } from '../../shared/import/blocks.ts'
import { type BookDetails, cleanDescription } from '../../shared/import/details.ts'
import { normalizeIsbn } from '../../shared/import/isbn.ts'
import { DESCRIPTION_MAX, PUBLISHER_MAX } from '../../shared/import/limits.ts'
import { isObject, only } from '../ask/input.ts'

export const TITLE_MAX = 300
export const AUTHOR_MAX = 200

export type DetailsForm =
  | { intent: 'details'; title: string; author: string; details: BookDetails }
  | { intent: 'remove-cover' }
  | { problem: 'invalid' | 'invalid-isbn' | 'too-long' }

const FORM_FIELDS = new Set(['intent', 'title', 'author', 'description', 'isbn', 'publisher', 'year'])

const line = (value: string) => cleanText(value).replace(/\s+/g, ' ').trim()

export function parseDetailsForm(form: FormData, now = new Date()): DetailsForm {
  for (const key of form.keys()) if (!FORM_FIELDS.has(key)) return { problem: 'invalid' }
  const field = (name: string): string | null => {
    const values = form.getAll(name)
    if (values.length > 1) return null
    const value = values[0] ?? ''
    return typeof value === 'string' ? value : null
  }
  const intent = field('intent')
  if (intent === 'remove-cover') return { intent: 'remove-cover' }
  if (intent !== 'details') return { problem: 'invalid' }

  const fields = ['title', 'author', 'description', 'isbn', 'publisher', 'year'].map(field)
  if (fields.some((f) => f === null)) return { problem: 'invalid' }
  const [rawTitle, rawAuthor, rawDescription, rawIsbn, rawPublisher, rawYear] = fields as string[]
  const title = line(rawTitle ?? '')
  const author = line(rawAuthor ?? '')
  if (!title || !author || [...title].length > TITLE_MAX || [...author].length > AUTHOR_MAX)
    return { problem: 'invalid' }

  const description = cleanDescription(rawDescription, { cap: false })
  if (description && description.length > DESCRIPTION_MAX) return { problem: 'too-long' }
  const isbnText = (rawIsbn ?? '').trim()
  const isbn = isbnText ? normalizeIsbn(isbnText) : null
  if (isbnText && !isbn) return { problem: 'invalid-isbn' }
  const publisher = line(rawPublisher ?? '') || null
  if (publisher && [...publisher].length > PUBLISHER_MAX) return { problem: 'invalid' }
  const yearText = (rawYear ?? '').trim()
  let publishedYear: number | null = null
  if (yearText) {
    if (!/^\d{1,4}$/.test(yearText)) return { problem: 'invalid' }
    publishedYear = Number(yearText)
    if (publishedYear < 1 || publishedYear > now.getUTCFullYear() + 1) return { problem: 'invalid' }
  }
  return { intent: 'details', title, author, details: { description, isbn, publisher, publishedYear } }
}

export type LookupQuery = { by: 'isbn'; isbn: string } | { by: 'title'; title: string; author: string }

export function parseLookup(value: unknown): LookupQuery | null {
  if (!isObject(value) || !only(value, ['title', 'author', 'isbn'])) return null
  const { title, author, isbn } = value
  if ([title, author, isbn].some((v) => v !== undefined && v !== null && typeof v !== 'string')) return null
  const isbn13 = typeof isbn === 'string' && isbn.trim() ? normalizeIsbn(isbn) : null
  if (isbn13) return { by: 'isbn', isbn: isbn13 }
  const t = typeof title === 'string' ? line(title) : ''
  const a = typeof author === 'string' ? line(author) : ''
  if (!t || [...t].length > TITLE_MAX || [...a].length > AUTHOR_MAX) return null
  return { by: 'title', title: t, author: a }
}

export interface ApplyInput {
  work: string
  coverId: number | null
  useCover: boolean
  useDescription: boolean
}

export const WORK_ID = /^OL\d{1,12}W$/

export function parseApply(value: unknown): ApplyInput | null {
  if (!isObject(value) || !only(value, ['work', 'coverId', 'useCover', 'useDescription'])) return null
  const { work, coverId, useCover, useDescription } = value
  if (typeof work !== 'string' || !WORK_ID.test(work)) return null
  if (typeof useCover !== 'boolean' || typeof useDescription !== 'boolean') return null
  if (coverId !== null && coverId !== undefined) {
    if (typeof coverId !== 'number' || !Number.isSafeInteger(coverId) || coverId < 1) return null
  }
  return { work, coverId: typeof coverId === 'number' ? coverId : null, useCover, useDescription }
}
