const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')

function stripDiacritics(text: string): string {
  return text.normalize('NFKD').replace(COMBINING_MARKS, '')
}

export function slugify(title: string): string {
  return stripDiacritics(title.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export const RESERVED_CHAPTER_SLUGS: ReadonlySet<string> = new Set(['ask'])

export function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base
  for (let i = 2; used.has(slug) || RESERVED_CHAPTER_SLUGS.has(slug); i++) slug = `${base}-${i}`
  used.add(slug)
  return slug
}
