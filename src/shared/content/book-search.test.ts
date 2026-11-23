import { describe, expect, it } from 'vitest'
import { searchBook } from './book-search'
import type { ChapterBook, PagedBook } from './schema'

const chapterBook: ChapterBook = {
  kind: 'chapter',
  slug: 'essays',
  chapters: [
    {
      id: 'ch_1',
      slug: 'history',
      title: 'History',
      pages: ['<p>There is one mind common to all individual men.</p>', '<p>Every man is an inlet to the same.</p>'],
    },
    {
      id: 'ch_2',
      slug: 'nature',
      title: 'Nature',
      pages: ['<p>To go into <em>solitude</em>, a man needs to retire.</p>'],
    },
  ],
}

const pagedBook: PagedBook = {
  kind: 'paged',
  slug: 'mystics',
  startPage: 7,
  endPage: 8,
  chapters: [{ id: 'ch_1', title: 'Rúmí', startPage: 7, endPage: 8, children: [] }],
  pages: [
    {
      pageNumber: 7,
      blocks: [
        {
          id: 'b',
          type: 'paragraph',
          alignment: 'justify',
          content: [
            { type: 'text', text: 'Listen to the reed, ' },
            { type: 'text', text: 'how it complains', gloss: 'x' },
          ],
        },
      ],
      footnotes: [],
    },
    {
      pageNumber: 8,
      blocks: [
        {
          id: 'c',
          type: 'paragraph',
          alignment: 'justify',
          content: [{ type: 'text', text: 'Of separation from the reed-bed.' }],
        },
      ],
      footnotes: [],
    },
  ],
}

describe('searchBook', () => {
  it('finds words across chapter pages and links to the screen page', () => {
    const results = searchBook(chapterBook, 'man')
    expect(results.map((r) => r.href)).toEqual(['/read/essays/history/2', '/read/essays/nature'])
    expect(results[0]?.chapterTitle).toBe('History')
  })

  it('strips markup and highlights the matched words in a snippet', () => {
    const [hit] = searchBook(chapterBook, 'solitude')
    expect(hit?.snippet.map((s) => s.text).join('')).toContain('To go into solitude, a man')
    expect(hit?.snippet.filter((s) => s.hit).map((s) => s.text)).toEqual(['solitude'])
  })

  it('requires every word of the query within one paragraph, ignoring accents', () => {
    expect(searchBook(chapterBook, 'MIND individual').map((r) => r.href)).toEqual(['/read/essays/history'])
    expect(searchBook(pagedBook, 'reed separation').map((r) => r.href)).toEqual(['/read/mystics/8'])
  })

  it('returns nothing for queries shorter than two characters', () => {
    expect(searchBook(chapterBook, 'a')).toEqual([])
  })

  it('caps the result count', () => {
    expect(searchBook(chapterBook, 'the', { limit: 1 })).toHaveLength(1)
  })
})
