import { isUuid } from '../uuid.ts'

/** What a book slug names: a catalogue book by its slug, or a private book by its id. */
export type ParsedBookSlug = { kind: 'catalogue'; slug: string } | { kind: 'private'; id: string }

/** A book as stored in a row: exactly one of the catalogue slug and the private book id is set. */
export type BookRef = { slug: string; userBookId: null } | { slug: null; userBookId: string }

const PRIVATE_PREFIX = 'u-'
const CATALOGUE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_LENGTH = 200

export function parseBookSlug(value: unknown): ParsedBookSlug | null {
  if (typeof value !== 'string' || value.length > MAX_LENGTH) return null
  if (value.startsWith(PRIVATE_PREFIX)) {
    const id = value.slice(PRIVATE_PREFIX.length)
    return isUuid(id) ? { kind: 'private', id } : null
  }
  return CATALOGUE.test(value) ? { kind: 'catalogue', slug: value } : null
}

export const isBookSlug = (value: unknown): value is string => parseBookSlug(value) !== null

export const isPrivateBookSlug = (value: unknown): value is string => parseBookSlug(value)?.kind === 'private'

export const isCatalogueBookSlug = (value: unknown): value is string => parseBookSlug(value)?.kind === 'catalogue'

/** Whether a value starts like a private book's slug, valid or not: for sweeps and guards that must over-match. */
export const hasPrivateSlugPrefix = (value: string): boolean => value.startsWith(PRIVATE_PREFIX)

export const privateBookSlug = (id: string): string => `${PRIVATE_PREFIX}${id}`

/** A slug that is not a private book's is taken as a catalogue slug, as rows store it. */
export function refFor(slug: string): BookRef {
  const parsed = parseBookSlug(slug)
  return parsed?.kind === 'private' ? { slug: null, userBookId: parsed.id } : { slug, userBookId: null }
}

export const slugOf = (ref: BookRef): string => ref.slug ?? privateBookSlug(ref.userBookId)
