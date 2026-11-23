import { isPrivateBookSlug } from '../content/book-slug.ts'
import { slugify } from '../import/slug.ts'
import { SITE_NAME } from '../lib/site.ts'
import { groupByChapter, type HighlightView } from './group.ts'

export interface ExportOptions {
  origin: string
  now: Date
}

export function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>&#$%=~|^]/g, '\\$&')
}

function escapeLine(line: string): string {
  return line.replace(
    /^(\s*)(?:([#>*+-])|(\d+)([.)]))/,
    (_m, indent: string, marker?: string, n?: string, dot?: string) =>
      marker ? `${indent}\\${marker}` : `${indent}${n}\\${dot}`,
  )
}

const quote = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `> ${escapeLine(escapeInline(line))}` : '>'))
    .join('\n')

export interface DateValue {
  date: Date
}

export type PropertyValue = string | number | DateValue | readonly string[]

const isoDate = (date: Date) => date.toISOString().slice(0, 10)

export function frontMatter(fields: readonly (readonly [string, PropertyValue])[]): string {
  const lines = ['---']
  for (const [key, value] of fields) {
    if (typeof value === 'string') lines.push(`${key}: ${JSON.stringify(value)}`)
    else if (typeof value === 'number') lines.push(`${key}: ${value}`)
    else if ('date' in value) lines.push(`${key}: ${isoDate(value.date)}`)
    else lines.push(`${key}:`, ...value.map((v) => `  - ${JSON.stringify(v)}`))
  }
  lines.push('---')
  return lines.join('\n')
}

const TAGS = [slugify(SITE_NAME), 'highlights']

function item(h: HighlightView, origin: string): string {
  const parts = [quote(h.text)]
  if (h.note) parts.push(h.note)
  if (h.place) parts.push(`[${h.place.label}](${origin}${h.place.href})`)
  return parts.join('\n\n')
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

const notesIn = (highlights: readonly HighlightView[]) => highlights.filter((h) => h.note).length

function bookBody(highlights: readonly HighlightView[], origin: string, level: number): string[] {
  const hashes = '#'.repeat(level)
  const { chapters, missing } = groupByChapter(highlights)
  const sections = [
    ...chapters.map((c) => ({
      heading: c.chapterTitle
        ? `${hashes} ${c.chapterIndex + 1}. ${escapeInline(c.chapterTitle)}`
        : `${hashes} Chapter ${c.chapterIndex + 1}`,
      items: c.highlights,
    })),
    ...(missing.length ? [{ heading: `${hashes} Passages no longer found`, items: missing }] : []),
  ]
  const out: string[] = []
  const total = sections.reduce((n, s) => n + s.items.length, 0)
  let written = 0
  for (const section of sections) {
    out.push(section.heading)
    for (const h of section.items) {
      out.push(item(h, origin))
      if (++written < total) out.push('---')
    }
  }
  if (!total) out.push('No highlights yet.')
  return out
}

const bookSource = (origin: string, slug: string) => `${origin}/account/highlights?book=${encodeURIComponent(slug)}`

export interface ExportBook {
  slug: string
  title: string
  author: string
}

export function toMarkdown(
  book: ExportBook,
  highlights: readonly HighlightView[],
  { origin, now }: ExportOptions,
): string {
  const properties = frontMatter([
    ['title', book.title],
    ...(book.author ? [['author', book.author] as const] : []),
    ['source', bookSource(origin, book.slug)],
    ['exported', { date: now }],
    ['highlights', highlights.length],
    ['notes', notesIn(highlights)],
    ['tags', TAGS],
  ])
  const byline = [
    book.author,
    count(highlights.length, 'highlight', 'highlights'),
    `exported from ${SITE_NAME} on ${isoDate(now)}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return `${[properties, `# ${escapeInline(book.title)}`, byline, ...bookBody(highlights, origin, 2)].join('\n\n')}\n`
}

export interface ExportAllBook extends ExportBook {
  removed: boolean
  highlights: readonly HighlightView[]
}

const byTitle = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

function inTitleOrder(books: readonly ExportAllBook[]): ExportAllBook[] {
  return [...books].sort(
    (a, b) =>
      Number(a.removed) - Number(b.removed) ||
      byTitle.compare(a.title, b.title) ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  )
}

export function toMarkdownAll(books: readonly ExportAllBook[], { origin, now }: ExportOptions): string {
  const ordered = inTitleOrder(books)
  const highlights = ordered.reduce((n, b) => n + b.highlights.length, 0)
  const notes = ordered.reduce((n, b) => n + notesIn(b.highlights), 0)
  const title = `${SITE_NAME} highlights`
  const out = [
    frontMatter([
      ['title', title],
      ['source', `${origin}/account/highlights`],
      ['exported', { date: now }],
      ['books', ordered.length],
      ['highlights', highlights],
      ['notes', notes],
      ['tags', TAGS],
    ]),
    `# ${title}`,
    [
      count(ordered.length, 'book', 'books'),
      count(highlights, 'highlight', 'highlights'),
      count(notes, 'note', 'notes'),
      `exported from ${SITE_NAME} on ${isoDate(now)}`,
    ].join(' · '),
  ]
  if (!ordered.length) out.push('No highlights yet.')
  for (const book of ordered) {
    const counts = [
      count(book.highlights.length, 'highlight', 'highlights'),
      count(notesIn(book.highlights), 'note', 'notes'),
    ]
    const byline = book.removed
      ? [`\`${book.slug}\``, ...counts]
      : [book.author, ...counts, `[Open in ${SITE_NAME}](${bookSource(origin, book.slug)})`].filter(Boolean)
    out.push(`## ${escapeInline(book.title)}`, byline.join(' · '), ...bookBody(book.highlights, origin, 3))
  }
  return `${out.join('\n\n')}\n`
}

export function exportFileName(slug: string, title: string): string {
  const base = isPrivateBookSlug(slug) ? slugify(title).slice(0, 80).replace(/-$/, '') || 'book' : slug
  return `${base}-highlights.md`
}

export function exportAllFileName(now: Date): string {
  return `${slugify(SITE_NAME)}-highlights-${isoDate(now)}.md`
}
