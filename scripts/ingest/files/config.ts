import type { Collection, CoverStyle, Series } from '../../../src/shared/content/schema.ts'
import type { EpubOptions } from '../../../src/shared/import/epub.ts'
import type { PdfOptions } from './pdf.ts'

export const COLLECTION: Omit<Collection, 'tagline'> = {
  slug: 'novels',
  title: 'Classic novels',
  kind: 'chapter',
  tone: 'default',
  order: 1,
}

export interface SeriesDef extends Omit<Series, 'collectionSlug'> {
  cover: CoverStyle
}

export const SERIES: SeriesDef[] = []

export interface BookDef {
  slug: string
  title: string
  author: string
  seriesSlug: string
  order: number
  shortDescription: string
  tagline: string
  language: string
  file: string
  download?: string
  source: { name: string; url: string; license: string }
  reader: { format: 'epub'; options: EpubOptions } | { format: 'pdf'; options: PdfOptions }
  coverImage?: false
  dropImages?: string[]
}

export const BOOKS: BookDef[] = []
