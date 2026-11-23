import { describe, expect, it } from 'vitest'
import { servedBooks } from '../../../tests/fixtures/served-books'
import type { Block, ChapterBook, PagedBook } from '../content/schema.ts'
import { chapterPageText, pagedPageText } from '../highlights/page-text.ts'
import { chapterPageBlocks, pagedPageBlocks, type SpeechPageText, speechChapter } from './speech-text.ts'

function expectWellFormed(page: SpeechPageText, where: string) {
  let last = 0
  for (const b of page.blocks) {
    expect(b.start, where).toBeGreaterThanOrEqual(last)
    expect(b.end, where).toBeGreaterThan(b.start)
    expect(b.end, where).toBeLessThanOrEqual(page.text.length)
    last = b.end
  }
}

const spans = (page: SpeechPageText) => page.blocks.map((b) => [page.text.slice(b.start, b.end), b.kind])

describe('every page the app serves', () => {
  it('reads the same text as highlights, with well-formed block spans', () => {
    let pages = 0
    for (const { file, book } of servedBooks()) {
      if (book.kind === 'chapter') {
        for (const chapter of book.chapters) {
          for (const [i, html] of chapter.pages.entries()) {
            const page = chapterPageBlocks(html)
            const where = `${file} ${chapter.slug} p.${i + 1}`
            expect(page.text, where).toBe(chapterPageText(html))
            expectWellFormed(page, where)
            pages++
          }
        }
      } else {
        for (const p of book.pages) {
          const page = pagedPageBlocks(p.blocks)
          expect(page.text, `${file} p.${p.pageNumber}`).toBe(pagedPageText(p.blocks))
          expectWellFormed(page, `${file} p.${p.pageNumber}`)
          pages++
        }
      }
    }
    expect(pages).toBeGreaterThan(250)
  })
})

describe('chapterPageBlocks', () => {
  it('decodes entities per text chunk, as chapterPageText does', () => {
    const page = chapterPageBlocks('<p>a &amp; b &lt;c&gt; &#8217;x&nbsp;y</p>')
    expect(page.text).toBe('a & b <c> ’x y')
    expect(spans(page)).toEqual([['a & b <c> ’x y', 'text']])
  })

  it('marks headings and code, and keeps escaped markup in code', () => {
    const page = chapterPageBlocks('<h3>Bindings</h3><p>Text.</p><pre>if (a &lt; b) {\n  go()\n}</pre>')
    expect(spans(page)).toEqual([
      ['Bindings', 'heading'],
      ['Text.', 'text'],
      ['if (a < b) {\n  go()\n}', 'code'],
    ])
  })

  it('reads inline code and emphasis inside the sentence they sit in', () => {
    expect(spans(chapterPageBlocks('<p>The <code>=</code> operator, <em>always</em>.</p>'))).toEqual([
      ['The = operator, always.', 'text'],
    ])
  })

  it('gives nested lists a span per item, cutting the parent item around the nested list', () => {
    const page = chapterPageBlocks('<ul><li>one<ul><li>inner</li></ul> after</li><li>two</li></ul>')
    expect(page.text).toBe('oneinner aftertwo')
    expect(spans(page)).toEqual([
      ['one', 'text'],
      ['inner', 'text'],
      [' after', 'text'],
      ['two', 'text'],
    ])
  })

  it('gives each table cell its own span', () => {
    const page = chapterPageBlocks(
      '<table><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody><tr><td>x</td><td>number</td></tr></tbody></table>',
    )
    expect(spans(page).map(([t]) => t)).toEqual(['Name', 'Type', 'x', 'number'])
  })

  it('reads paragraphs inside a quotation, and the verse and question paragraphs', () => {
    expect(spans(chapterPageBlocks('<blockquote><p>First.</p><p>Second.</p></blockquote>'))).toEqual([
      ['First.', 'text'],
      ['Second.', 'text'],
    ])
    expect(spans(chapterPageBlocks('<p class="question">Why?</p><p class="verse">Line one<br>line two</p>'))).toEqual([
      ['Why?', 'text'],
      ['Line one', 'text'],
      ['line two', 'text'],
    ])
  })

  it('reads text outside any block as prose, and gives nothing for an empty page', () => {
    expect(spans(chapterPageBlocks('loose'))).toEqual([['loose', 'text']])
    expect(chapterPageBlocks('')).toEqual({ text: '', blocks: [] })
    expect(chapterPageBlocks('<p></p>').blocks).toEqual([])
  })
})

describe('pagedPageBlocks', () => {
  const blocks: Block[] = [
    { id: 'b1', type: 'heading', alignment: 'center', depth: 2, content: [{ type: 'text', text: 'On Doubt' }] },
    {
      id: 'b2',
      type: 'paragraph',
      alignment: 'justify',
      content: [
        { type: 'text', text: 'The ' },
        { type: 'text', text: 'Sufis', gloss: 'mystics' },
        { type: 'footnoteRef', refId: 'fn_1', text: '1' },
        { type: 'text', text: ' said ' },
        { type: 'arabic', text: 'بسم الله' },
        { type: 'text', text: '.' },
      ],
    },
    { id: 'b3', type: 'paragraph', alignment: 'justify', content: [{ type: 'footnoteRef', refId: 'x', text: '2' }] },
  ]

  it('gives a span per block in the offsets pagedPageText counts, footnote references left out', () => {
    const page = pagedPageBlocks(blocks)
    expect(page.text).toBe(pagedPageText(blocks))
    expect(spans(page)).toEqual([
      ['On Doubt', 'heading'],
      ['The Sufis said بسم الله.', 'text'],
    ])
  })
})

describe('speechChapter', () => {
  const chapterBook: ChapterBook = {
    kind: 'chapter',
    slug: 'essays',
    chapters: [
      { id: 'ch_1', slug: 'history', title: 'History', pages: ['<p>One.</p>', '<p>Two.</p>'] },
      { id: 'ch_2', slug: 'self-reliance', title: 'Self-Reliance', pages: ['<p>Three.</p>'] },
    ],
  }
  const block = (n: number): Block => ({
    id: `b${n}`,
    type: 'paragraph',
    alignment: 'justify',
    content: [{ type: 'text', text: `Page ${n}.` }],
  })
  const pagedBook: PagedBook = {
    kind: 'paged',
    slug: 'confessions',
    startPage: 5,
    endPage: 10,
    chapters: [
      { id: 'c1', title: 'Introduction', startPage: 7, endPage: 8, children: [] },
      { id: 'c2', title: 'The Search', startPage: 9, endPage: 10, children: [] },
    ],
    pages: [5, 6, 7, 8, 9, 10].map((pageNumber) => ({ pageNumber, blocks: [block(pageNumber)], footnotes: [] })),
  }

  it("gives a chapter book's chapter with its pages, hrefs and labels", () => {
    const chapter = speechChapter(chapterBook, 0)
    expect(chapter).toMatchObject({ index: 0, slug: 'history', title: 'History', number: 1, chapterCount: 2 })
    expect(chapter?.pages.map((p) => [p.position, p.href, p.label, p.text])).toEqual([
      [{ chapter: 'history', page: 1 }, '/read/essays/history', 'Ch. 1 · p. 1', 'One.'],
      [{ chapter: 'history', page: 2 }, '/read/essays/history/2', 'Ch. 1 · p. 2', 'Two.'],
    ])
  })

  it("gives a paged chapter its own printed pages, and never the front matter the reader can't show", () => {
    const first = speechChapter(pagedBook, 0)
    expect(first).toMatchObject({ index: 0, slug: null, title: 'Introduction', number: null, chapterCount: 2 })
    expect(first?.pages.map((p) => [p.position, p.href, p.label])).toEqual([
      [{ printedPage: 7 }, '/read/confessions/7', 'p. 7'],
      [{ printedPage: 8 }, '/read/confessions/8', 'p. 8'],
    ])
    expect(speechChapter(pagedBook, 1)?.pages.map((p) => p.text)).toEqual(['Page 9.', 'Page 10.'])
  })

  it('is null for a chapter that is not there', () => {
    for (const index of [-1, 2, 1.5, Number.NaN]) {
      expect(speechChapter(chapterBook, index)).toBeNull()
      expect(speechChapter(pagedBook, index)).toBeNull()
    }
  })
})

describe('a figure read aloud', () => {
  it('reads its caption as one paragraph, and nothing of the picture', () => {
    const html =
      '<p>Before.</p><figure><a href="/p"><img src="/p" alt="A map of the bay" width="10" height="10" loading="lazy" ' +
      'decoding="async"></a><figcaption>The <em>bay</em> at dawn</figcaption></figure>' +
      '<figure><a href="/q" aria-label="View picture"><img src="/q" alt="" width="10" height="10" loading="lazy" decoding="async"></a></figure>'
    const page = chapterPageBlocks(html)
    expect(page.text).toBe(chapterPageText(html))
    expect(page.blocks.map((b) => [page.text.slice(b.start, b.end), b.kind])).toEqual([
      ['Before.', 'text'],
      ['The bay at dawn', 'text'],
    ])
  })
})
