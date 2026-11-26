export const SITE_NAME = 'Folio'
export const SITE_TAGLINE = 'A quiet place to read and listen.'
export const SITE_CREDIT =
  'Books are in the public domain or shared under open licences; each book’s page credits its source. A book without its own cover gets a generated one.'

export const PRIVACY_UPDATED = '2026-11-25'

export const TERMS_UPDATED = '2026-11-25'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function shortDate(when: Date | string): string {
  const date = typeof when === 'string' ? new Date(when.length === 10 ? `${when}T00:00:00Z` : when) : when
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}
