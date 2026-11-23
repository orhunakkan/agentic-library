import { languageTag, titleFromFileName } from '../detect.ts'
import { normalizeIsbn } from '../isbn.ts'
import type { PdfInfo, PdfPage } from './types.ts'

export const ISBN_PAGES = 8

const FILE_NAME_TITLE = /\.(docx?|odt|rtf|tex|dvi|ps|pdf|indd|pages|qxd|txt)$|^untitled\b|^microsoft word\s*-/i

export interface PdfBookMetadata {
  title: string
  author: string
  language: string
  isbn: string | null
}

export function pdfMetadata(info: PdfInfo, pages: readonly PdfPage[], fileName: string): PdfBookMetadata {
  const infoTitle = info.title && !FILE_NAME_TITLE.test(info.title.trim()) ? info.title : null
  return {
    title: info.xmpTitle ?? infoTitle ?? largestText(pages[0]) ?? titleFromFileName(fileName),
    author: info.xmpCreator ?? info.author ?? '',
    language: languageTag(info.language) ?? 'en',
    isbn: printedIsbn(pages.slice(0, ISBN_PAGES)),
  }
}

function largestText(page: PdfPage | undefined): string | null {
  const items = page?.items.filter((i) => !i.rotated && i.text.trim()) ?? []
  if (!items.length) return null
  const largest = Math.max(...items.map((i) => i.size))
  const text = items
    .filter((i) => largest - i.size < 0.5)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((i) => i.text.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

const ISBN_CANDIDATE = /(?:97[89][-\s]?)?\d(?:[-\s]?\d){8}[-\s]?[\dX]\b/gi
const LABELLED = /isbn(?:-1[03])?[:\s]*$/i

function printedIsbn(pages: readonly PdfPage[]): string | null {
  const text = pages
    .map((p) => p.items.map((i) => i.text).join(' '))
    .join('\n')
    .replace(/[‐‑‒–]/g, '-')
  let unlabelled: string | null = null
  for (const match of text.matchAll(ISBN_CANDIDATE)) {
    const isbn = normalizeIsbn(match[0])
    if (!isbn) continue
    if (LABELLED.test(text.slice(Math.max(0, match.index - 12), match.index))) return isbn
    unlabelled ??= isbn
  }
  return unlabelled
}
