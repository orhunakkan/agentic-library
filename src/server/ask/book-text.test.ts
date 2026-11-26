import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BookContent, ChapterBook, PagedBook } from '~/shared/content/schema'
import { bookText } from './book-text'

const load = <T extends BookContent>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T

const pride = load<ChapterBook>('tests/fixtures/content/books/pride-and-prejudice.json')
const prophet = load<ChapterBook>('tests/fixtures/content/books/the-prophet.json')
const code = load<ChapterBook>('tests/fixtures/content/books/fixture-code-book.json')
const ghazzali = load<PagedBook>('tests/fixtures/content/books/confessions-of-al-ghazzali.json')

describe('bookText on the catalogue and fixture books', () => {
  for (const book of [pride, prophet, code]) {
    it(`${book.slug}: one entry per screen page, in reading order, with no empty blocks`, () => {
      const text = bookText(book)
      expect(text.pages).toHaveLength(book.chapters.reduce((n, c) => n + c.pages.length, 0))
      expect(text.chapters.map((c) => c.slug)).toEqual(book.chapters.map((c) => c.slug))
      for (const [i, chapter] of text.chapters.entries()) {
        const pages = text.pages.slice(chapter.firstPage, chapter.firstPage + chapter.pageCount)
        expect(pages.every((p) => p.chapterIndex === i)).toBe(true)
      }
      for (const page of text.pages) {
        expect(page.blocks.length).toBeGreaterThan(0)
        expect(page.blocks.every((b) => b.trim() === b && b.length > 0)).toBe(true)
      }
    })
  }

  it('leaves no markup in prose', () => {
    for (const book of [prophet, pride]) {
      const all = bookText(book)
        .pages.flatMap((p) => p.blocks)
        .join('\n')
      expect(all, book.slug).not.toMatch(/<\/?[a-z]+>|&[a-z]+;/)
    }
  })

  it('decodes text a book writes about markup exactly once', () => {
    const all = bookText(code)
      .pages.flatMap((p) => p.blocks)
      .join('\n')
    expect(all).toContain('A plain opening angle bracket is written as `&lt;` (“less than”)')
    expect(all).toContain('```\n<!doctype html>\n<p>Fish &amp; chips</p>\n```')
  })

  it('links and labels each page as the reader addresses it', () => {
    const text = bookText(pride)
    const third = text.chapters[2]
    expect(third?.slug).toBe('chapter-3')
    const page = text.pages[(third?.firstPage ?? 0) + 1]
    expect(page).toMatchObject({
      href: '/read/pride-and-prejudice/chapter-3/2',
      label: 'Ch. 3 · p. 2',
      heading: 'Chapter 3: Chapter 3, page 2',
      printedPage: null,
    })
    expect(text.pages[third?.firstPage ?? 0]?.href).toBe('/read/pride-and-prejudice/chapter-3')
  })

  it('keeps the line breaks of code listings', () => {
    const text = bookText(code)
    const page = text.pages.find((p) => p.href === '/read/fixture-code-book/values-and-names/2')
    expect(page?.blocks[0]).toBe('```\nlet ten = 10;\nconsole.log(ten * ten);\n// → 100\n```')
  })

  it('decodes entities in prose, code and tables', () => {
    const all = bookText(code)
      .pages.flatMap((p) => p.blocks)
      .join('\n')
    expect(all).toContain('`"Folio"`')
    expect(all).toContain('→ 100')
    expect(all.replace('`&lt;`', '').replace('`&amp;`', '').replace('Fish &amp; chips', '')).not.toMatch(
      /&(gt|lt|amp|quot);/,
    )
  })
})

describe('bookText on a paged book', () => {
  const text = bookText(ghazzali)

  it('gives one entry per printed page, labelled by its printed number', () => {
    expect(text.kind).toBe('paged')
    expect(text.pages).toHaveLength(ghazzali.pages.length)
    expect(text.pages[0]).toMatchObject({
      href: '/read/confessions-of-al-ghazzali/7',
      label: 'p. 7',
      heading: 'Chapter 1: Introduction, page 7',
      printedPage: 7,
      chapterIndex: 0,
    })
  })

  it('assigns pages to the chapter whose range holds them', () => {
    const page14 = text.pages.find((p) => p.printedPage === 14)
    expect(page14?.chapterIndex).toBe(2)
    expect(text.chapters[2]).toMatchObject({ title: 'The Subterfuges of the Sophists', slug: null, pageCount: 4 })
    expect(text.pages[text.chapters[2]?.firstPage ?? -1]?.printedPage).toBe(14)
  })

  it('keeps glossary terms and Arabic as they read, and puts footnotes after the page text', () => {
    const page7 = text.pages.find((p) => p.printedPage === 7)
    expect(page7?.blocks.join('\n')).toContain('بِسْمِ ٱللَّٰهِ')
    const page8 = text.pages.find((p) => p.printedPage === 8)
    expect(page8?.blocks[0]).toContain('III. The Sufis, who claim an immediate intuition,')
    const page31 = text.pages.find((p) => p.printedPage === 31)
    expect(page31?.blocks.join('\n')).toContain('[1]')
    expect(page31?.blocks.at(-1)).toBe('Footnotes:\n[1] I.e. There is nothing new under the sun.')
  })

  it('joins a heading block to the paragraph after it', () => {
    const book: PagedBook = {
      kind: 'paged',
      slug: 'tiny',
      startPage: 1,
      endPage: 1,
      chapters: [],
      pages: [
        {
          pageNumber: 1,
          footnotes: [],
          blocks: [
            { id: 'a', type: 'heading', alignment: 'center', depth: 1, content: [{ type: 'text', text: 'Title' }] },
            { id: 'b', type: 'paragraph', alignment: 'justify', content: [{ type: 'text', text: 'Body.' }] },
          ],
        },
      ],
    }
    const tiny = bookText(book)
    expect(tiny.pages[0]?.blocks).toEqual(['Title\n\nBody.'])
    expect(tiny.chapters).toHaveLength(1)
    expect(tiny.pages[0]?.heading).toBe('Page 1')
  })
})
