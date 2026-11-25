import { MIN_CHAPTERS, MIN_MEDIAN_WORDS, median } from '../detect.ts'
import { charCount, type PdfLine, type PdfStyle, roundSize, STYLE_KINDS, type StyleKind } from './types.ts'

export const HEADING_RATIO = 1.08
export const SHOWN_SHARE = 0.005
export const SHOWN_MAX = 10
export const SAMPLE_LENGTH = 60
const GAP_RATIO = 1.4
const SAME_SIZE = 0.5

export interface BodyStyle {
  style: string
  size: number
}

export function bodyStyle(pages: readonly PdfLine[][]): BodyStyle {
  const chars = new Map<string, { chars: number; size: number }>()
  for (const line of pages.flat())
    for (const run of line.runs) {
      if (run.sup) continue
      const entry = chars.get(run.style) ?? { chars: 0, size: roundSize(run.size) }
      entry.chars += charCount(run.text)
      chars.set(run.style, entry)
    }
  const [best] = [...chars]
    .filter(([, e]) => e.chars > 0)
    .sort((a, b) => b[1].chars - a[1].chars || (a[0] < b[0] ? -1 : 1))
  return best ? { style: best[0], size: best[1].size } : { style: '', size: 10 }
}

export function bodyLineGap(pages: readonly PdfLine[][], body: BodyStyle): number {
  const gaps: number[] = []
  for (const lines of pages)
    for (let i = 1; i < lines.length; i++) {
      const [a, b] = [lines[i - 1] as PdfLine, lines[i] as PdfLine]
      const gap = b.y - a.y
      if (a.style === body.style && b.style === body.style && gap > 0) gaps.push(gap)
    }
  return median(gaps) || body.size * 1.2
}

interface Stat {
  key: string
  font: string
  size: number
  chars: number
  text: string
  mono: boolean
  bold: boolean
  math: boolean
}

function stats(pages: readonly PdfLine[][]): Stat[] {
  const byKey = new Map<string, Stat>()
  for (const line of pages.flat())
    for (const run of line.runs) {
      if (run.sup) continue
      let stat = byKey.get(run.style)
      if (!stat) {
        stat = {
          key: run.style,
          font: run.font.replace(/^[A-Z]{6}\+/, ''),
          size: roundSize(run.size),
          chars: 0,
          text: '',
          mono: run.mono,
          bold: run.bold,
          math: run.math,
        }
        byKey.set(run.style, stat)
      }
      stat.chars += charCount(run.text)
      if (stat.text.length < SAMPLE_LENGTH * 2) stat.text += ` ${run.text}`
    }
  return [...byKey.values()].sort((a, b) => b.chars - a.chars || (a.key < b.key ? -1 : 1))
}

function standsAlone(key: string, pages: readonly PdfLine[][], gap: number): boolean {
  let alone = 0
  let all = 0
  for (const lines of pages)
    lines.forEach((line, i) => {
      const chars = line.runs.reduce((n, r) => n + (r.style === key && !r.sup ? charCount(r.text) : 0), 0)
      if (!chars) return
      all += chars
      const previous = lines[i - 1]
      const spaced = !previous || line.y - previous.y > gap * GAP_RATIO
      if (line.style === key && spaced) alone += chars
    })
  return all > 0 && alone / all > 0.5
}

export function chapterWordsBy(key: string, pages: readonly PdfLine[][]): number[] {
  const chapters: number[] = []
  let previousWasHeading = false
  for (const line of pages.flat()) {
    if (line.style === key) {
      if (!previousWasHeading) chapters.push(0)
      previousWasHeading = true
      continue
    }
    previousWasHeading = false
    if (chapters.length)
      chapters[chapters.length - 1] = (chapters.at(-1) as number) + line.text.split(/\s+/).filter(Boolean).length
  }
  return chapters
}

const makesChapters = (key: string, pages: readonly PdfLine[][]) => {
  const words = chapterWordsBy(key, pages)
  return words.length >= MIN_CHAPTERS && median(words) >= MIN_MEDIAN_WORDS
}

export function styleTable(pages: readonly PdfLine[][], body: BodyStyle): PdfStyle[] {
  const all = stats(pages)
  const gap = bodyLineGap(pages, body)
  const hasLines = (key: string) => pages.some((lines) => lines.some((l) => l.style === key))
  const candidates = all
    .filter((s) => s.key !== body.style && !s.mono && !s.math && hasLines(s.key))
    .filter(
      (s) =>
        s.size >= body.size * HEADING_RATIO ||
        (s.bold && Math.abs(s.size - body.size) <= SAME_SIZE && standsAlone(s.key, pages, gap)),
    )
    .sort((a, b) => b.size - a.size || b.chars - a.chars)
  const guesses = new Map<string, StyleKind>()
  const chapter = candidates.findIndex((s) => makesChapters(s.key, pages))
  candidates.forEach((s, i) => {
    if (chapter < 0) guesses.set(s.key, i === 0 ? 'h3' : 'h4')
    else if (i < chapter) guesses.set(s.key, 'h3')
    else if (i === chapter) guesses.set(s.key, 'chapter')
    else guesses.set(s.key, i === chapter + 1 ? 'h3' : 'h4')
  })
  return all.map((s) => ({
    key: s.key,
    font: s.font,
    size: s.size,
    chars: s.chars,
    sample: s.text.replace(/\s+/g, ' ').trim().slice(0, SAMPLE_LENGTH),
    guess: s.mono ? 'code' : (guesses.get(s.key) ?? 'body'),
  }))
}

export function shownStyles(styles: readonly PdfStyle[]): PdfStyle[] {
  const total = styles.reduce((n, s) => n + s.chars, 0)
  const listed = (s: PdfStyle) => s.guess !== 'body' || (total > 0 && s.chars / total >= SHOWN_SHARE)
  return [...styles]
    .sort((a, b) => b.chars - a.chars)
    .filter(listed)
    .slice(0, SHOWN_MAX)
}

export function styleKinds(
  styles: readonly PdfStyle[],
  overrides: Record<string, StyleKind> = {},
): Map<string, StyleKind> {
  const kinds = new Map<string, StyleKind>()
  for (const s of styles) {
    const chosen = Object.hasOwn(overrides, s.key) ? overrides[s.key] : undefined
    kinds.set(s.key, chosen && STYLE_KINDS.includes(chosen) ? chosen : s.guess)
  }
  return kinds
}
