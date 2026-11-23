export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfText {
  text: string
  x: number
  y: number
  width: number
  size: number
  font: string
  bold: boolean
  italic: boolean
  mono: boolean
  math: boolean
  rotated: boolean
}

export interface PdfPage {
  number: number
  width: number
  height: number
  items: PdfText[]
  images: Box[]
  paths: Box[]
}

export interface PdfOutlineEntry {
  title: string
  page: number
  y: number
  children: PdfOutlineEntry[]
}

export interface PdfInfo {
  title: string | null
  author: string | null
  xmpTitle: string | null
  xmpCreator: string | null
  language: string | null
}

export interface PdfSource {
  pages: PdfPage[]
  outline: PdfOutlineEntry[]
  info: PdfInfo
}

export interface LineRun {
  text: string
  x: number
  width: number
  size: number
  font: string
  style: string
  bold: boolean
  italic: boolean
  mono: boolean
  math: boolean
  sup: boolean
}

export interface PdfLine {
  page: number
  x: number
  y: number
  width: number
  size: number
  style: string
  runs: LineRun[]
  text: string
}

export type StyleKind = 'chapter' | 'h3' | 'h4' | 'body' | 'code' | 'drop'
export const STYLE_KINDS: readonly StyleKind[] = ['chapter', 'h3', 'h4', 'body', 'code', 'drop']

export interface PdfStyle {
  key: string
  font: string
  size: number
  chars: number
  sample: string
  guess: StyleKind
}

export interface PdfOverrides {
  styles?: Record<string, StyleKind>
  chapters?: 'outline' | 'headings'
  pages?: { first: number; last: number }
}

export interface Region {
  page: number
  n: number
  key: string
  box: Box
  kind: 'image' | 'figure' | 'equation'
  alt: string
  caption: string | null
}

export interface PdfLayoutReport {
  pages: number
  chapters: 'outline' | 'headings' | 'single'
  hasOutline: boolean
  twoColumnPages: number
  furniturePages: number
  pictures: number
}

export const roundSize = (size: number): number => Math.round(size * 2) / 2
export const styleKey = (font: string, size: number): string => `${font}@${roundSize(size)}`

export const charCount = (text: string): number => text.replace(/\s/g, '').length
