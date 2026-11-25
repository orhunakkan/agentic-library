import type { PdfLayoutReport, PdfOverrides, PdfStyle, StyleKind } from '~/shared/import/pdf/types'

/** `n` and the word for it, singular or plural: "1 page", "2,000 pages". */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

const CHAPTERS_TEXT: Record<PdfLayoutReport['chapters'], string> = {
  outline: 'chapters from the PDF’s bookmarks',
  headings: 'chapters from the headings',
  single: 'one chapter: no chapter headings were found',
}

export function readingSummary(report: PdfLayoutReport): string {
  const parts = [plural(report.pages, 'page'), CHAPTERS_TEXT[report.chapters]]
  if (report.twoColumnPages) parts.push(`two columns on ${plural(report.twoColumnPages, 'page')}`)
  if (report.furniturePages)
    parts.push(`page numbers and running headers left out on ${plural(report.furniturePages, 'page')}`)
  if (report.pictures) parts.push(`${plural(report.pictures, 'picture')} cropped from the pages`)
  return `${parts.join(' · ')}.`
}

export const KIND_LABELS: readonly { kind: StyleKind; label: string }[] = [
  { kind: 'chapter', label: 'Chapter title' },
  { kind: 'h3', label: 'Section heading' },
  { kind: 'h4', label: 'Subheading' },
  { kind: 'body', label: 'Body text' },
  { kind: 'code', label: 'Code' },
  { kind: 'drop', label: 'Leave out' },
]

export const fontText = (style: PdfStyle): string => `${style.font}, ${style.size.toLocaleString('en-GB')}pt`

export function shareText(style: PdfStyle, styles: readonly PdfStyle[]): string {
  const total = styles.reduce((n, s) => n + s.chars, 0)
  const share = total ? (style.chars / total) * 100 : 0
  if (share >= 1) return `${Math.round(share)}%`
  return `${share < 0.1 ? '<0.1' : share.toFixed(1)}%`
}

export const kindOf = (style: PdfStyle, overrides: PdfOverrides): StyleKind =>
  overrides.styles?.[style.key] ?? style.guess

export const bodyOf = (styles: readonly PdfStyle[]): PdfStyle | undefined =>
  styles.reduce<PdfStyle | undefined>((best, s) => (!best || s.chars > best.chars ? s : best), undefined)

export const sampleScale = (style: PdfStyle, body: PdfStyle | undefined): number =>
  Math.min(2, Math.max(0.75, body ? style.size / body.size : 1))

export const withKind = (overrides: PdfOverrides, style: PdfStyle, kind: StyleKind): PdfOverrides => ({
  ...overrides,
  styles: { ...overrides.styles, [style.key]: kind },
})

export const chapterSource = (report: PdfLayoutReport): 'outline' | 'headings' =>
  report.chapters === 'outline' ? 'outline' : 'headings'
