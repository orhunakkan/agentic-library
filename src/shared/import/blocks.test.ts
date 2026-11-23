import { describe, expect, it } from 'vitest'
import { checkBlock, checkBookUpload, checkChapterUpload, cleanText, LIST_DEPTH_MAX, UploadError } from './blocks'
import { NO_DETAILS } from './details'

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return error instanceof UploadError ? error.code : `not an UploadError: ${error}`
  }
  return 'accepted'
}

const nested = (depth: number): unknown =>
  depth === 0
    ? { runs: [{ text: 'leaf' }] }
    : { runs: [], lists: [{ type: 'list', ordered: false, items: [nested(depth - 1)] }] }

describe('checkChapterUpload', () => {
  it('accepts every block type and returns them cleaned', () => {
    const chapter = checkChapterUpload({
      title: '  Café \u0007 ',
      blocks: [
        { type: 'heading', level: 3, runs: [{ text: 'Head' }] },
        { type: 'paragraph', runs: [{ text: 'a\tb\nc' }, { br: true }, { text: 'x', style: 'em' }] },
        { type: 'blockquote', paragraphs: [[{ text: 'q' }]] },
        { type: 'list', ordered: true, items: [{ runs: [{ text: 'i' }], lists: [] }] },
        { type: 'table', head: [[[{ text: 'h' }]]], body: [[[{ text: 'd', style: 'code' }]]] },
        { type: 'code', text: 'line 1\r\n\tline 2\u0000' },
      ],
    })
    expect(chapter.title).toBe('Café')
    expect(chapter.blocks[1]).toEqual({
      type: 'paragraph',
      runs: [{ text: 'a b c' }, { br: true }, { text: 'x', style: 'em' }],
    })
    expect(chapter.blocks[5]).toEqual({ type: 'code', text: 'line 1\n\tline 2' })
  })

  it('rejects unknown block types, styles and fields', () => {
    expect(code(() => checkBlock({ type: 'html', html: '<script>' }))).toBe('invalid')
    expect(code(() => checkBlock({ type: 'paragraph', runs: [{ text: 'x', style: 'a' }] }))).toBe('invalid')
    expect(code(() => checkBlock({ type: 'paragraph', runs: [{ text: 'x', href: 'javascript:' }] }))).toBe('invalid')
    expect(code(() => checkBlock({ type: 'paragraph', runs: [], class: 'x' }))).toBe('invalid')
    expect(code(() => checkBlock({ type: 'heading', level: 1, runs: [] }))).toBe('invalid')
    expect(code(() => checkBlock({ type: 'paragraph', runs: [{ br: 'yes' }] }))).toBe('invalid')
    expect(code(() => checkBlock({ type: 'paragraph', runs: [{ text: 42 }] }))).toBe('invalid')
    expect(code(() => checkBlock({ type: 'paragraph', runs: 'text' }))).toBe('invalid')
    expect(code(() => checkBlock(null))).toBe('invalid')
    expect(code(() => checkChapterUpload({ title: 'x', blocks: [], extra: 1 }))).toBe('invalid')
    expect(code(() => checkChapterUpload({ title: ' ', blocks: [] }))).toBe('invalid')
    expect(code(() => checkChapterUpload([]))).toBe('invalid')
  })

  it('keeps a code block’s language only when it is one Run code knows', () => {
    expect(checkBlock({ type: 'code', text: 'print(1)', lang: 'python' })).toEqual({
      type: 'code',
      text: 'print(1)',
      lang: 'python',
    })
    expect(checkBlock({ type: 'code', text: 'x' })).toEqual({ type: 'code', text: 'x' })
    for (const lang of ['ruby', 'js', '"><script>', '', 1, null])
      expect(code(() => checkBlock({ type: 'code', text: 'x', lang }))).toBe('invalid')
  })

  it('rejects oversized text', () => {
    expect(code(() => checkBlock({ type: 'paragraph', runs: [{ text: 'x'.repeat(50_000) }] }))).toBe('accepted')
    expect(code(() => checkBlock({ type: 'paragraph', runs: [{ text: 'x'.repeat(50_001) }] }))).toBe('too-long')
    expect(code(() => checkBlock({ type: 'code', text: 'x'.repeat(200_001) }))).toBe('too-long')
    expect(code(() => checkChapterUpload({ title: 't'.repeat(301), blocks: [] }))).toBe('too-long')
    const blocks = (n: number) => Array.from({ length: n }, () => ({ type: 'paragraph', runs: [{ text: 'x' }] }))
    expect(code(() => checkChapterUpload({ title: 'x', blocks: blocks(5000) }))).toBe('accepted')
    expect(code(() => checkChapterUpload({ title: 'x', blocks: blocks(5001) }))).toBe('too-long')
    const runs = Array.from({ length: 5001 }, () => ({ text: 'x' }))
    expect(code(() => checkBlock({ type: 'paragraph', runs }))).toBe('too-long')
  })

  it('limits how deep lists nest', () => {
    const list = (depth: number) => ({ type: 'list', ordered: false, items: [nested(depth - 1)] })
    expect(code(() => checkBlock(list(LIST_DEPTH_MAX)))).toBe('accepted')
    expect(code(() => checkBlock(list(LIST_DEPTH_MAX + 1)))).toBe('too-long')
  })
})

describe('checkBookUpload', () => {
  const book = { title: 'T', author: 'A', language: 'en', chapterCount: 3 }

  it('accepts metadata and a chapter count', () => {
    expect(checkBookUpload({ ...book, title: ' Trimmed ' }, 1000)).toEqual({
      ...book,
      title: 'Trimmed',
      details: NO_DETAILS,
      images: { count: 0, bytes: 0 },
    })
  })

  it('takes the pictures a book declares, within 500 and 30 MB', () => {
    expect(checkBookUpload({ ...book, images: { count: 42, bytes: 5_000_000 } }, 1000).images).toEqual({
      count: 42,
      bytes: 5_000_000,
    })
    expect(checkBookUpload({ ...book, images: { count: 500, bytes: 30 * 1024 * 1024 } }, 1000).images.count).toBe(500)
    for (const images of [
      { count: 501, bytes: 600 },
      { count: 1, bytes: 30 * 1024 * 1024 + 1 },
      { count: 2, bytes: 1 },
      { count: 1, bytes: 921601 },
      { count: -1, bytes: 0 },
      { count: 1.5, bytes: 10 },
      { count: '1', bytes: 10 },
      { count: 1 },
      { count: 1, bytes: 10, extra: true },
      [1, 10],
    ])
      expect(
        code(() => checkBookUpload({ ...book, images }, 1000)),
        JSON.stringify(images),
      ).toBe('invalid')
  })

  it('accepts the four details, cleaned and normalised, and empty ones as null', () => {
    const upload = checkBookUpload(
      {
        ...book,
        description: '<p>A <em>novel</em>.</p><p>Two.</p>',
        isbn: '0-14-143951-3',
        publisher: '  Penguin\tClassics ',
        publishedYear: 2003,
      },
      1000,
    )
    expect(upload.details).toEqual({
      description: 'A novel.\n\nTwo.',
      isbn: '9780141439518',
      publisher: 'Penguin Classics',
      publishedYear: 2003,
    })
    const empty = checkBookUpload({ ...book, description: ' ', isbn: '', publisher: '', publishedYear: null }, 1000)
    expect(empty.details).toEqual(NO_DETAILS)
  })

  it('refuses a bad ISBN, a long description or publisher, a future year and the wrong types', () => {
    const next = new Date().getUTCFullYear() + 1
    expect(checkBookUpload({ ...book, publishedYear: next }, 1000).details.publishedYear).toBe(next)
    expect(checkBookUpload({ ...book, description: 'a '.repeat(2000) }, 1000).details.description).toHaveLength(3999)
    for (const bad of [
      { isbn: '9780141439519' },
      { description: 'word '.repeat(801) },
      { publisher: 'p'.repeat(201) },
      { publishedYear: next + 1 },
      { publishedYear: 0 },
      { publishedYear: 1999.5 },
      { publishedYear: '1999' },
      { description: 3 },
      { isbn: 9780141439518 },
      { publisher: ['x'] },
    ])
      expect(code(() => checkBookUpload({ ...book, ...bad }, 1000))).toBe('invalid')
  })

  it('rejects bad metadata', () => {
    expect(code(() => checkBookUpload({ ...book, language: 'english' }, 1000))).toBe('invalid')
    expect(code(() => checkBookUpload({ ...book, author: '' }, 1000))).toBe('invalid')
    expect(code(() => checkBookUpload({ ...book, chapterCount: 0 }, 1000))).toBe('invalid')
    expect(code(() => checkBookUpload({ ...book, chapterCount: 1.5 }, 1000))).toBe('invalid')
    expect(code(() => checkBookUpload({ ...book, chapterCount: 1001 }, 1000))).toBe('too-long')
    expect(code(() => checkBookUpload({ ...book, owner: 'someone' }, 1000))).toBe('invalid')
  })
})

describe('cleanText', () => {
  it('normalises to NFC and strips control and bidi-override characters', () => {
    expect(cleanText('é')).toBe('é')
    expect(cleanText('a‮b⁦c\u0085d')).toBe('abcd')
    expect(cleanText('keep\nlines', true)).toBe('keep\nlines')
    expect(cleanText('keep\nlines')).toBe('keep lines')
  })
})

describe('image blocks', () => {
  const image = (fields: Record<string, unknown>) => ({ type: 'image', image: 1, alt: 'A map', ...fields })

  it('takes a picture with its alt text and caption, cleaned', () => {
    expect(checkBlock(image({ alt: ' A\u0007  map\n', caption: [{ text: 'The\tharbour' }] }))).toEqual({
      type: 'image',
      image: 1,
      alt: 'A map',
      caption: [{ text: 'The harbour' }],
    })
    expect(checkBlock(image({ image: 500 }))).toEqual({ type: 'image', image: 500, alt: 'A map' })
    expect(checkBlock(image({ caption: [{ text: ' ' }] }))).toEqual({ type: 'image', image: 1, alt: 'A map' })
    expect(checkBlock(image({ image: 0, caption: [{ text: 'Figure 1' }] }))).toMatchObject({ image: 0 })
  })

  it.each([
    ['a number over 500', { image: 501 }, 'invalid'],
    ['a negative number', { image: -1 }, 'invalid'],
    ['a fraction', { image: 1.5 }, 'invalid'],
    ['a string', { image: '1' }, 'invalid'],
    ['no picture and no caption', { image: 0 }, 'invalid'],
    ['no picture and an empty caption', { image: 0, caption: [{ text: '  ' }] }, 'invalid'],
    ['an unknown field', { src: 'x.png' }, 'invalid'],
    ['alt that is not text', { alt: 1 }, 'invalid'],
    ['alt over 1,000 characters', { alt: 'a'.repeat(1001) }, 'too-long'],
    [
      'a caption over 2,000 characters',
      { caption: [{ text: 'a'.repeat(1500) }, { text: 'b'.repeat(501) }] },
      'too-long',
    ],
    ['a caption that is not runs', { caption: 'Figure 1' }, 'invalid'],
  ])('refuses %s', (_, fields, problem) => {
    expect(code(() => checkBlock(image(fields)))).toBe(problem)
  })

  it('refuses a missing alt', () => {
    expect(code(() => checkBlock({ type: 'image', image: 1 }))).toBe('invalid')
  })
})
