import type { ChapterBook, PagedBook } from '~/shared/content/schema'
import { fixtureCatalog } from './catalog'

const text = (t: string) => ({ type: 'text' as const, text: t })

export const pagedFixture: PagedBook = {
  kind: 'paged',
  slug: 'confessions',
  startPage: 7,
  endPage: 11,
  chapters: [
    { id: 'ch_1', title: 'Introduction', startPage: 7, endPage: 8, children: [] },
    {
      id: 'ch_2',
      title: 'The Search',
      startPage: 9,
      endPage: 11,
      children: [
        { id: 'ch_2_1', title: 'Doubt', pageNumber: 10 },
        { id: 'ch_2_2', title: 'Certainty', pageNumber: 11 },
      ],
    },
  ],
  pages: [7, 8, 9, 10, 11].map((pageNumber) => ({
    pageNumber,
    blocks: [
      {
        id: `b_${pageNumber}_1`,
        type: 'paragraph' as const,
        alignment: 'justify' as const,
        content: [text(`Page ${pageNumber}`)],
      },
    ],
    footnotes: [],
  })),
}

export const chapterFixture: ChapterBook = {
  kind: 'chapter',
  slug: 'essays',
  chapters: [
    { id: 'ch_1', slug: 'history', title: 'History', pages: ['<p>h1</p>', '<p>h2</p>', '<p>h3</p>'] },
    { id: 'ch_2', slug: 'self-reliance', title: 'Self-Reliance', pages: ['<p>s1</p>'] },
  ],
}

export const metaFor = (slug: string) => {
  const meta = fixtureCatalog.books.find((b) => b.slug === slug)
  if (!meta) throw new Error(slug)
  return meta
}
