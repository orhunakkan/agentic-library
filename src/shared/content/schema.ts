export type CollectionKind = 'paged' | 'chapter'

export type Tone = 'warm' | 'default'

export interface Collection {
  slug: string
  title: string
  tagline: string
  kind: CollectionKind
  tone: Tone
  order: number
}

export interface Series {
  slug: string
  title: string
  description: string
  collectionSlug: string
  featuredLabel?: string
}

export interface CoverStyle {
  background: [string, string]
  ink: string
  motif: 'arch' | 'star' | 'rings' | 'leaf' | 'wave' | 'grid'
}

export interface BookMeta {
  id: string
  slug: string
  title: string
  author: string
  seriesSlug: string
  order: number
  shortDescription: string
  language: string
  tagline?: string
  kind: CollectionKind
  cover: CoverStyle
  coverImage?: {
    file: string
    type: 'image/jpeg' | 'image/png' | 'image/webp'
    width: number
    height: number
    hash: string
  }
  chapterCount: number
  startPage?: number
  endPage?: number
  audioDurationMs?: number
  source: { name: string; url: string; license: string }
}

export interface Catalog {
  collections: Collection[]
  series: Series[]
  books: BookMeta[]
}

export type Inline =
  | { type: 'text'; text: string; gloss?: string; bold?: true; italic?: true }
  | { type: 'arabic'; text: string }
  | { type: 'footnoteRef'; refId: string; text: string }

export interface Block {
  id: string
  type: 'paragraph' | 'heading'
  alignment: 'justify' | 'center'
  depth?: number
  content: Inline[]
}

export interface Footnote {
  id: string
  content: Inline[]
}

export interface PagedPage {
  pageNumber: number
  blocks: Block[]
  footnotes: Footnote[]
}

export interface PagedSubsection {
  id: string
  title: string
  pageNumber: number
}

export interface PagedChapter {
  id: string
  title: string
  startPage: number
  endPage: number
  children: PagedSubsection[]
}

export interface PagedBook {
  kind: 'paged'
  slug: string
  startPage: number
  endPage: number
  chapters: PagedChapter[]
  pages: PagedPage[]
}

export interface ChapterBookChapter {
  id: string
  slug: string
  title: string
  pages: string[]
}

export interface ChapterBook {
  kind: 'chapter'
  slug: string
  chapters: ChapterBookChapter[]
}

export type BookContent = PagedBook | ChapterBook

export interface AudioEpisode {
  id: string
  slug: string
  title: string
  number: number
  durationMs: number
  audioUrl: string
  chapterRef?: string
}

export interface AudioBook {
  bookSlug: string
  credit: string
  sourceUrl: string
  episodes: AudioEpisode[]
}
