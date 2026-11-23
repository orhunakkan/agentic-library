import { describe, expect, it } from 'vitest'
import type { HighlightView } from './group.ts'
import {
  type ExportAllBook,
  escapeInline,
  exportAllFileName,
  exportFileName,
  frontMatter,
  toMarkdown,
  toMarkdownAll,
} from './markdown.ts'

const origin = 'https://agenticlibrary.app'
const now = new Date('2026-11-04T23:30:00.000Z')

function h(
  id: string,
  text: string,
  place: { chapterIndex: number; title: string; label: string; position: number } | null,
  note: string | null = null,
): HighlightView {
  return {
    id,
    color: 'yellow',
    note,
    text,
    status: place ? 'ok' : 'missing',
    place: place && {
      chapterIndex: place.chapterIndex,
      chapterTitle: place.title,
      chapter: 'chapter-3',
      page: 2,
      pageHref: '/read/pride-and-prejudice/chapter-3/2',
      href: `/read/pride-and-prejudice/chapter-3/2#highlight-${id}`,
      label: place.label,
      position: place.position,
      start: 0,
      end: text.length,
    },
    createdAt: '2026-11-04T10:00:00.000Z',
    updatedAt: '2026-11-04T10:00:00.000Z',
  }
}

const book = { slug: 'pride-and-prejudice', title: 'Pride and Prejudice', author: 'Jane Austen' }

describe('toMarkdown', () => {
  it('writes the documented file: chapters, quoted passages, notes, links and the missing ones last', () => {
    const md = toMarkdown(
      book,
      [
        h('gone', 'A passage the book no longer has.', null),
        h(
          '6f1c',
          'Mr. Bingley was good looking and gentlemanlike; he had a pleasant countenance, and easy, unaffected manners.',
          { chapterIndex: 2, title: 'Chapter 3', label: 'Ch. 3 · p. 2', position: 5 },
          'The first impression everyone shares.',
        ),
      ],
      { origin, now },
    )
    expect(md).toBe(`---
title: "Pride and Prejudice"
author: "Jane Austen"
source: "https://agenticlibrary.app/account/highlights?book=pride-and-prejudice"
exported: 2026-11-04
highlights: 2
notes: 1
tags:
  - "folio"
  - "highlights"
---

# Pride and Prejudice

Jane Austen · 2 highlights · exported from Folio on 2026-11-04

## 3. Chapter 3

> Mr. Bingley was good looking and gentlemanlike; he had a pleasant countenance, and easy, unaffected manners.

The first impression everyone shares.

[Ch. 3 · p. 2](https://agenticlibrary.app/read/pride-and-prejudice/chapter-3/2#highlight-6f1c)

---

## Passages no longer found

> A passage the book no longer has.
`)
  })

  it('quotes every line, blank ones too, and escapes lines that start with a Markdown marker', () => {
    const md = toMarkdown(
      book,
      [
        h('a', '# not a heading\n\n- not a list\n  * nor this\n> nor a quote\n+ plus\n1. one\nplain', {
          chapterIndex: 0,
          title: 'One',
          label: 'Ch. 1 · p. 1',
          position: 0,
        }),
      ],
      { origin, now },
    )
    expect(md).toContain(
      '> \\# not a heading\n>\n> \\- not a list\n>   \\* nor this\n> \\> nor a quote\n> \\+ plus\n> 1\\. one\n> plain',
    )
  })

  it('keeps a note’s line breaks as written', () => {
    const md = toMarkdown(
      book,
      [h('a', 'x', { chapterIndex: 0, title: 'One', label: 'Ch. 1 · p. 1', position: 0 }, 'line one\nline two')],
      { origin, now },
    )
    expect(md).toContain('> x\n\nline one\nline two\n\n[Ch. 1 · p. 1]')
  })

  it('separates highlights with rules, says one highlight in the singular, and handles none', () => {
    const one = toMarkdown(book, [h('a', 'x', { chapterIndex: 0, title: 'One', label: 'Ch. 1 · p. 1', position: 0 })], {
      origin,
      now,
    })
    expect(one).toContain('Jane Austen · 1 highlight ·')
    expect(one.match(/^---$/gm)).toHaveLength(2)
    const two = toMarkdown(
      book,
      [
        h('a', 'x', { chapterIndex: 0, title: 'One', label: 'Ch. 1 · p. 1', position: 0 }),
        h('b', 'y', { chapterIndex: 0, title: 'One', label: 'Ch. 1 · p. 1', position: 1 }),
      ],
      { origin, now },
    )
    expect(two.match(/^---$/gm)).toHaveLength(3)
    expect(toMarkdown({ slug: 't', title: 'T', author: '' }, [], { origin, now })).toMatch(
      /\n---\n\n# T\n\n0 highlights · exported from Folio on 2026-11-04\n\nNo highlights yet\.\n$/,
    )
  })

  it('starts with properties that keep an awkward title one string and leave out an empty author', () => {
    const md = toMarkdown({ slug: 'u-1', title: 'Notes: "Draft" #2', author: '' }, [], { origin, now })
    expect(md).toMatch(/^---\ntitle: "Notes: \\"Draft\\" #2"\nsource: "https:\/\/agenticlibrary\.app\//)
    expect(md).not.toContain('author:')
    expect(md).toContain('\nexported: 2026-11-04\n')
    expect(md).toContain('\n# Notes: "Draft" \\#2\n')
  })

  it('escapes passages and chapter titles for Obsidian, but leaves notes as written', () => {
    const md = toMarkdown(
      book,
      [
        h(
          'a',
          'A #tag, [[a link]], $x$, %%hidden%%, ==marked==, ^block, &lt; <b>bold</b> *a* _b_ `c` ~d~ a|b \\ done',
          { chapterIndex: 0, title: 'One *two* #three', label: 'Ch. 1 · p. 1', position: 0 },
          'A **bold** note with a #tag.',
        ),
      ],
      { origin, now },
    )
    expect(md).toContain(
      '> A \\#tag, \\[\\[a link\\]\\], \\$x\\$, \\%\\%hidden\\%\\%, \\=\\=marked\\=\\=, \\^block, \\&lt; \\<b\\>bold\\</b\\> \\*a\\* \\_b\\_ \\`c\\` \\~d\\~ a\\|b \\\\ done',
    )
    expect(md).toContain('## 1. One \\*two\\* \\#three')
    expect(md).toContain('\n\nA **bold** note with a #tag.\n\n')
  })
})

describe('escapeInline', () => {
  it('puts a backslash before each character Markdown or Obsidian could read, the backslash first', () => {
    for (const c of '`*_[]<>&#$%=~|^') expect(escapeInline(c)).toBe(`\\${c}`)
    expect(escapeInline('\\')).toBe('\\\\')
    expect(escapeInline('\\#')).toBe('\\\\\\#')
    expect(escapeInline('Plain words, a full stop. (And brackets!)')).toBe('Plain words, a full stop. (And brackets!)')
  })
})

describe('frontMatter', () => {
  it('writes strings as JSON, numbers and dates bare, and lists one per line', () => {
    expect(
      frontMatter([
        ['a', 'x: y'],
        ['n', 3],
        ['d', { date: now }],
        ['l', ['p', 'q']],
      ]),
    ).toBe('---\na: "x: y"\nn: 3\nd: 2026-11-04\nl:\n  - "p"\n  - "q"\n---')
  })
})

describe('toMarkdownAll', () => {
  const at = (chapterIndex: number) => ({ chapterIndex, title: `Chapter ${chapterIndex + 1}`, label: 'p', position: 0 })
  const all = (over: Partial<ExportAllBook> & { slug: string }): ExportAllBook => ({
    title: over.slug,
    author: '',
    removed: false,
    highlights: [h(`${over.slug}-1`, 'x', at(0))],
    ...over,
  })

  it('orders books by title, case, accents and numbers considered, with removed books last', () => {
    const md = toMarkdownAll(
      [
        all({
          slug: 'old-book',
          title: 'A book no longer in the library',
          removed: true,
          highlights: [h('m', 'y', null)],
        }),
        all({ slug: 'book-10', title: 'Book 10' }),
        all({ slug: 'emile', title: 'Émile' }),
        all({ slug: 'book-2', title: 'book 2' }),
        all({ slug: 'zebra', title: 'Zebra' }),
        all({ slug: 'apple', title: 'apple' }),
      ],
      { origin, now },
    )
    const headings = md.match(/^## .*$/gm)
    expect(headings).toEqual([
      '## apple',
      '## book 2',
      '## Book 10',
      '## Émile',
      '## Zebra',
      '## A book no longer in the library',
    ])
  })

  it('writes the documented file: properties, counts, a section per book, ### chapters, no rule between books', () => {
    const md = toMarkdownAll(
      [
        all({
          slug: 'pride-and-prejudice',
          title: 'Pride and Prejudice',
          author: 'Jane Austen',
          highlights: [h('p1', 'First.', at(5), 'A note.'), h('p2', 'Second.', at(6))],
        }),
        all({
          slug: 'old-book-slug',
          title: 'A book no longer in the library',
          removed: true,
          highlights: [h('m', 'Gone.', null, 'Kept.')],
        }),
      ],
      { origin, now },
    )
    expect(md).toBe(`---
title: "Folio highlights"
source: "https://agenticlibrary.app/account/highlights"
exported: 2026-11-04
books: 2
highlights: 3
notes: 2
tags:
  - "folio"
  - "highlights"
---

# Folio highlights

2 books · 3 highlights · 2 notes · exported from Folio on 2026-11-04

## Pride and Prejudice

Jane Austen · 2 highlights · 1 note · [Open in Folio](https://agenticlibrary.app/account/highlights?book=pride-and-prejudice)

### 6. Chapter 6

> First.

A note.

[p](https://agenticlibrary.app/read/pride-and-prejudice/chapter-3/2#highlight-p1)

---

### 7. Chapter 7

> Second.

[p](https://agenticlibrary.app/read/pride-and-prejudice/chapter-3/2#highlight-p2)

## A book no longer in the library

\`old-book-slug\` · 1 highlight · 1 note

### Passages no longer found

> Gone.

Kept.
`)
  })

  it('says "No highlights yet." once when there are no books', () => {
    const md = toMarkdownAll([], { origin, now })
    expect(md).toMatch(
      /\n# Folio highlights\n\n0 books · 0 highlights · 0 notes · exported from Folio on 2026-11-04\n\nNo highlights yet\.\n$/,
    )
    expect(md).toContain('\nbooks: 0\n')
  })
})

describe('exportAllFileName', () => {
  it('is folio-highlights with the UTC date', () => {
    expect(exportAllFileName(now)).toBe('folio-highlights-2026-11-04.md')
  })
})

describe('exportFileName', () => {
  it('uses the slug for a catalogue book and the title for a private one', () => {
    expect(exportFileName('pride-and-prejudice', 'Pride and Prejudice')).toBe('pride-and-prejudice-highlights.md')
    expect(exportFileName('u-6f1c0000-0000-4000-8000-000000000000', 'Field Notes: Spring')).toBe(
      'field-notes-spring-highlights.md',
    )
    expect(exportFileName('u-6f1c0000-0000-4000-8000-000000000000', '???')).toBe('book-highlights.md')
  })
})
