import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeEpub, words } from '../../../tests/fixtures/zip'
import type { BookBlock, DraftChapter } from './blocks'
import { NO_DETAILS } from './details'
import {
  BOOK_ROOM,
  chapterRequest,
  dropChapter,
  finishDraft,
  mergeIntoPrevious,
  openBook,
  oversizedChapters,
  type PictureState,
  planPictures,
  previewPages,
  renameChapter,
  saveableChapters,
  sourceKind,
  splitOversized,
} from './draft'
import { MAX_CHAPTER_BLOCKS, MAX_CHAPTER_REQUEST_BYTES, MAX_CHAPTERS } from './limits'

const para = (text: string) => ({ type: 'paragraph' as const, runs: [{ text }] })
const chapters: DraftChapter[] = [
  { title: 'One', blocks: [para('a')] },
  { title: 'Two', blocks: [para('b')] },
  { title: 'Three', blocks: [para('c')] },
]

describe('editing a draft', () => {
  it('renames and drops chapters', () => {
    expect(renameChapter(chapters, 1, 'Second').map((c) => c.title)).toEqual(['One', 'Second', 'Three'])
    expect(dropChapter(chapters, 0).map((c) => c.title)).toEqual(['Two', 'Three'])
  })

  it('merges a chapter into the previous one, keeping its title as a heading', () => {
    const merged = mergeIntoPrevious(chapters, 2)
    expect(merged.map((c) => c.title)).toEqual(['One', 'Two'])
    expect(merged[1]?.blocks).toEqual([para('b'), { type: 'heading', level: 3, runs: [{ text: 'Three' }] }, para('c')])
    expect(mergeIntoPrevious(chapters, 0)).toEqual(chapters)
  })

  it('previews pages as the reader will show them', () => {
    expect(previewPages({ title: 'x', blocks: [para('<b>')] })).toEqual(['<p>&lt;b&gt;</p>'])
  })
})

describe('splitOversized', () => {
  it('cuts a chapter over the request limit into parts between blocks', () => {
    const big: DraftChapter = { title: 'Big', blocks: Array.from({ length: 40 }, (_, i) => para(`${i} ${words(100)}`)) }
    const parts = splitOversized([big], { maxBytes: 12_000 })
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.map((p) => p.title).slice(0, 3)).toEqual(['Big', 'Big (part 2)', 'Big (part 3)'])
    expect(parts.flatMap((p) => p.blocks)).toEqual(big.blocks)
    for (const part of parts) expect(new TextEncoder().encode(chapterRequest(part)).length).toBeLessThanOrEqual(12_000)
    expect(oversizedChapters(parts, 12_000)).toEqual([])
  })

  it('also cuts a chapter with more blocks than the server takes', () => {
    const many: DraftChapter = { title: 'Many', blocks: Array.from({ length: 7 }, (_, i) => para(`${i}`)) }
    expect(splitOversized([many], { maxBlocks: 3 }).map((p) => p.blocks.length)).toEqual([3, 3, 1])
  })

  it('leaves chapters under the limit alone, and reports a single block that can never fit', () => {
    expect(splitOversized(chapters, { maxBytes: 12_000 })).toEqual(chapters)
    expect(oversizedChapters([{ title: 'x', blocks: [para('y'.repeat(20_000))] }], 12_000)).toEqual([0])
  })
})

describe('saveableChapters', () => {
  it('names a chapter with no title by its place, drops an empty one, and splits one too large', () => {
    const big: DraftChapter = {
      title: 'Big',
      blocks: Array.from({ length: MAX_CHAPTER_BLOCKS + 1 }, (_, i) => para(`${i}`)),
    }
    const saved = saveableChapters([
      { title: '  ', blocks: [para('a')] },
      { title: 'Empty', blocks: [] },
      { title: 'Three', blocks: [para('c')] },
      big,
    ])
    expect(saved.ok && saved.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Three', 'Big', 'Big (part 2)'])
  })

  it('refuses a book with no chapter left, too many, or a block that can never fit', () => {
    expect(saveableChapters([{ title: 'Empty', blocks: [] }])).toEqual({ ok: false, problem: 'none' })
    const many = Array.from({ length: MAX_CHAPTERS + 1 }, (_, i) => ({ title: `${i}`, blocks: [para('x')] }))
    expect(saveableChapters(many)).toEqual({ ok: false, problem: 'too-many' })
    expect(saveableChapters(many.slice(1)).ok).toBe(true)
    const huge = { title: 'Huge', blocks: [para('y'.repeat(MAX_CHAPTER_REQUEST_BYTES))] }
    expect(saveableChapters([huge])).toEqual({ ok: false, problem: 'oversized' })
  })
})

describe('openBook', () => {
  it('reads a file by its extension', async () => {
    expect(sourceKind('Book.EPUB')).toBe('epub')
    expect(sourceKind('notes.markdown')).toBe('markdown')
    expect(sourceKind('site.zip')).toBe('zip')
    expect(sourceKind('paper.PDF')).toBe('pdf')
    expect(sourceKind('notes.txt')).toBeNull()
    const book = await openBook('notes.md', new TextEncoder().encode('# Notes\n\nHello.'))
    expect(book).toMatchObject({ title: 'Notes', language: 'en', chapters: [{ title: 'Notes' }] })
  })

  it('carries the file’s cover and details into the draft', async () => {
    const cover = new Uint8Array(readFileSync(new URL('../../../tests/fixtures/images/cover.jpg', import.meta.url)))
    const epub = makeEpub({
      files: [{ name: 'a.xhtml', body: `<h2>One</h2><p>${words(320)}</p>` }],
      cover: { name: 'cover.jpg', data: cover },
      description: 'About it.',
      isbn: '9780141439518',
    })
    const book = await openBook('book.epub', epub)
    expect(book.cover).toMatchObject({ from: 'epub', info: { type: 'image/jpeg', width: 400, height: 600 } })
    expect(book.details).toEqual({
      description: 'About it.',
      isbn: '9780141439518',
      publisher: null,
      publishedYear: null,
    })
  })

  it('explains what went wrong', async () => {
    await expect(openBook('notes.txt', new Uint8Array(1))).rejects.toThrow('Choose an .epub, .pdf, .md or .zip file.')
    await expect(openBook('broken.epub', new Uint8Array(10))).rejects.toThrow(/couldn’t be read/)
    await expect(openBook('empty.md', new TextEncoder().encode('   '))).rejects.toThrow(
      'No text was found in this file.',
    )
  })
})

describe('finishDraft', () => {
  const book = { title: 'T', author: 'A', language: 'en', details: NO_DETAILS, cover: null, pictures: [] }

  it('cuts chapters too large for one upload into parts', () => {
    const many = { title: 'Long', blocks: Array.from({ length: 5001 }, (_, i) => para(`p${i}`)) }
    const finished = finishDraft({ ...book, chapters: [many] })
    expect(finished.chapters.map((c) => [c.title, c.blocks.length])).toEqual([
      ['Long', 5000],
      ['Long (part 2)', 1],
    ])
    expect(finished).toMatchObject({ title: 'T', author: 'A', language: 'en', cover: null, pictures: [] })
  })

  it('refuses a book with no text', () => {
    expect(() => finishDraft({ ...book, chapters: [] })).toThrow('No text was found in this file.')
  })

  it('is not how a PDF is opened: that is the browser’s pdf-open.ts', async () => {
    await expect(openBook('paper.pdf', new Uint8Array(1))).rejects.toThrow(/does not read PDFs/)
  })
})

describe('planPictures', () => {
  const pic = (image: number, caption?: string): BookBlock =>
    caption ? { type: 'image', image, alt: '', caption: [{ text: caption }] } : { type: 'image', image, alt: '' }
  const ok = (bytes = 100): PictureState => ({ ok: true, bytes, width: 400, height: 300 })
  const states: Record<number, PictureState> = {
    1: ok(),
    2: ok(),
    3: { ok: false, problem: 'remote' },
    4: { ok: false, problem: 'small' },
    5: ok(),
    6: { ok: false, problem: 'unreadable' },
  }
  const state = (n: number) => states[n]
  const book: DraftChapter[] = [
    { title: 'One', blocks: [para('a'), pic(2), pic(3, 'From the web'), pic(4), pic(2)] },
    { title: 'Two', blocks: [pic(1), pic(6), pic(0, 'Listing 1')] },
    { title: 'Three', blocks: [pic(5), pic(3)] },
  ]

  it('numbers the kept pictures by first appearance, the same picture twice as one', () => {
    const plan = planPictures(book, state, BOOK_ROOM())
    expect(plan.uploads).toEqual([2, 1, 5])
    expect(plan.bytes).toBe(300)
    expect(plan.chapters.map((c) => c.blocks)).toEqual([
      [para('a'), pic(1), pic(0, 'From the web'), pic(1)],
      [pic(2), pic(0, 'Listing 1')],
      [pic(3)],
    ])
    expect(plan.leftOut).toEqual({ remote: 1, large: 0, unreadable: 1, missing: 0, book: 0, room: 0 })
    expect(plan.numbers).toEqual(
      new Map([
        [2, 1],
        [1, 2],
        [5, 3],
      ]),
    )
  })

  it('counts only the chapters kept, dropped or merged', () => {
    const merged = mergeIntoPrevious(dropChapter(book, 0), 1)
    const plan = planPictures(merged, state, BOOK_ROOM())
    expect(plan.uploads).toEqual([1, 5])
    expect(plan.leftOut).toMatchObject({ remote: 1, unreadable: 1 })
  })

  it('leaves out pictures past the book’s count and bytes, then past the account’s room, in book order', () => {
    expect(planPictures(book, state, { count: 2, bytes: 1000, userBytesLeft: 1000 })).toMatchObject({
      uploads: [2, 1],
      leftOut: { book: 1, room: 0 },
    })
    expect(planPictures(book, state, { count: 10, bytes: 250, userBytesLeft: 1000 })).toMatchObject({
      uploads: [2, 1],
      leftOut: { book: 1 },
    })
    const roomy = planPictures(book, state, { count: 10, bytes: 1000, userBytesLeft: 150 })
    expect(roomy).toMatchObject({ uploads: [2], leftOut: { book: 0, room: 2 } })
    expect(roomy.chapters[1]?.blocks).toEqual([pic(0, 'Listing 1')])
  })

  it('counts a picture the browser never got to as unreadable', () => {
    expect(planPictures([{ title: 'T', blocks: [pic(9)] }], () => undefined, BOOK_ROOM()).leftOut.unreadable).toBe(1)
  })

  it('renders the preview with the pictures it is given', () => {
    const pages = previewPages(
      { title: 'T', blocks: [pic(1)] },
      { imageSrc: () => 'blob:x', imageSize: () => ({ width: 10, height: 10 }) },
    )
    expect(pages[0]).toContain('<img src="blob:x"')
    expect(previewPages({ title: 'T', blocks: [pic(1, 'Cap')] })[0]).toBe(
      '<figure><figcaption>Cap</figcaption></figure>',
    )
  })
})
