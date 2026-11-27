import { describe, expect, it } from 'vitest'
import type { Block, ChapterBook, PagedBook } from '~/shared/content/schema.ts'
import { bookPages, chapterPageText, pagedPageText, pageIndexOf } from '~/shared/highlights/page-text.ts'

describe('chapterPageText', () => {
  it('removes tags and decodes entities, as textContent reads them', () => {
    expect(chapterPageText('<p>a &amp; b &lt;c&gt; &#8217;x&#x2192;</p><p>next</p>')).toBe('a & b <c> ’x→next')
  })

  it('adds nothing for <br>, and keeps a non-breaking space as U+00A0', () => {
    expect(chapterPageText('<p class="verse">one<br>two<br/>three</p>')).toBe('onetwothree')
    expect(chapterPageText('<p>a&nbsp;b</p>')).toBe('a b')
  })

  it('reads a runnable listing as it reads any other: its data-lang adds nothing', () => {
    const code = 'let ten = 10;\nconsole.log(ten * ten)'
    expect(chapterPageText(`<p>a</p><pre data-lang="javascript">${code}</pre>`)).toBe(
      chapterPageText(`<p>a</p><pre>${code}</pre>`),
    )
  })

  it('keeps code line breaks, indentation and escaped markup', () => {
    expect(chapterPageText('<pre>if (a &lt; b) {\n  return &quot;x&quot;\n}</pre>')).toBe(
      'if (a < b) {\n  return "x"\n}',
    )
  })

  it('reads nested lists and tables in document order', () => {
    expect(chapterPageText('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')).toBe('abc')
    expect(
      chapterPageText(
        '<table><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
      ),
    ).toBe('h1h21')
  })
})

describe('pagedPageText', () => {
  it('reads text, Arabic and glossary terms, leaves out footnote references and joins blocks with nothing', () => {
    const blocks: Block[] = [
      { id: 'b1', type: 'heading', alignment: 'center', depth: 2, content: [{ type: 'text', text: 'Title' }] },
      {
        id: 'b2',
        type: 'paragraph',
        alignment: 'justify',
        content: [
          { type: 'text', text: 'The ' },
          { type: 'text', text: 'Sufis', gloss: 'mystics' },
          { type: 'footnoteRef', refId: 'fn_8_1', text: '1' },
          { type: 'text', text: ' say ' },
          { type: 'arabic', text: 'بسم' },
        ],
      },
    ]
    expect(pagedPageText(blocks)).toBe('TitleThe Sufis say بسم')
  })
})

describe('bookPages', () => {
  it('lists a chapter book’s screen pages in reading order with hrefs and labels', () => {
    const book: ChapterBook = {
      kind: 'chapter',
      slug: 'b',
      chapters: [
        { id: 'c1', slug: 'one', title: 'One', pages: ['<p>a</p>', '<p>b</p>'] },
        { id: 'c2', slug: 'two', title: 'Two', pages: ['<p>c</p>'] },
      ],
    }
    const pages = bookPages(book)
    expect(pages.map((p) => [p.chapterIndex, p.chapterSlug, p.page, p.href, p.label, p.text])).toEqual([
      [0, 'one', 1, '/read/b/one', 'Ch. 1 · p. 1', 'a'],
      [0, 'one', 2, '/read/b/one/2', 'Ch. 1 · p. 2', 'b'],
      [1, 'two', 1, '/read/b/two', 'Ch. 2 · p. 1', 'c'],
    ])
    expect(pageIndexOf(pages, { chapter: 'one', page: 2 })).toBe(1)
    expect(pageIndexOf(pages, { chapter: 'one', page: 3 })).toBe(-1)
    expect(pageIndexOf(pages, { printedPage: 1 })).toBe(-1)
  })

  it('lists a paged book’s printed pages, front matter in the first chapter', () => {
    const page = (n: number) => ({
      pageNumber: n,
      blocks: [
        {
          id: `b${n}`,
          type: 'paragraph' as const,
          alignment: 'justify' as const,
          content: [{ type: 'text' as const, text: `p${n}` }],
        },
      ],
      footnotes: [],
    })
    const book: PagedBook = {
      kind: 'paged',
      slug: 'p',
      startPage: 1,
      endPage: 4,
      chapters: [
        { id: 'c1', title: 'First', startPage: 2, endPage: 3, children: [] },
        { id: 'c2', title: 'Second', startPage: 4, endPage: 4, children: [] },
      ],
      pages: [page(1), page(2), page(3), page(4)],
    }
    const pages = bookPages(book)
    expect(pages.map((p) => [p.chapterIndex, p.chapterTitle, p.chapterSlug, p.page, p.href, p.label])).toEqual([
      [0, 'First', null, 1, '/read/p/1', 'p. 1'],
      [0, 'First', null, 2, '/read/p/2', 'p. 2'],
      [0, 'First', null, 3, '/read/p/3', 'p. 3'],
      [1, 'Second', null, 4, '/read/p/4', 'p. 4'],
    ])
    expect(pageIndexOf(pages, { printedPage: 3 })).toBe(2)
    expect(pageIndexOf(pages, { chapter: 'first', page: 1 })).toBe(-1)
  })
})

describe('a figure’s page text', () => {
  it('is its caption’s text: the picture’s alt is an attribute, not text', () => {
    const figure =
      '<p>Before.</p><figure><a href="/account/books/x/images/1" aria-label="View picture"><img src="/account/books/x/images/1" ' +
      'alt="a &gt; b &quot;c&quot;" width="600" height="300" loading="lazy" decoding="async"></a>' +
      '<figcaption>The <em>bay</em> &amp; harbour</figcaption></figure><p>After.</p>'
    expect(chapterPageText(figure)).toBe('Before.The bay & harbourAfter.')
    expect(chapterPageText('<figure><figcaption>Listing 1</figcaption></figure>')).toBe('Listing 1')
  })
})
