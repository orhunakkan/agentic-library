export const SITE_NAME = 'Folio'
export const SITE_TAGLINE = 'A quiet place to read and listen.'
export const SITE_CREDIT =
  'Books you upload stay private to your account. A book without its own cover gets a generated one.'

export const PRIVACY_UPDATED = '2026-11-27'

export const TERMS_UPDATED = '2026-11-26'

export const COPYRIGHT_UPDATED = '2026-11-26'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function shortDate(when: Date | string): string {
  const date = typeof when === 'string' ? new Date(when.length === 10 ? `${when}T00:00:00Z` : when) : when
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}
