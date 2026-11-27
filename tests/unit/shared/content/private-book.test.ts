import { describe, expect, it } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import {
  buildPrivateAudiobookPage,
  buildPrivateBookPage,
  fileSize,
  myArticles,
  myShelf,
  partialChapterBook,
  privateBookHref,
  privateCover,
  privateCoverImage,
  privateCoverUrl,
  privateReaderContext,
} from '~/shared/content/private-book'
import { buildReaderView } from '~/shared/content/reader-view'
import { NO_DETAILS } from '~/shared/import/details'

const ID = '0f8e2a9c-1b3d-4c5e-8f70-123456789abc'
const SLUG = privateBookSlug(ID)
const COVER = { width: 600, height: 900, sha256: `abcdef12${'0'.repeat(56)}`, source: 'upload' as const }

describe('reading a private book', () => {
  const chapters = [
    { slug: 'one', title: 'One', pageCount: 2 },
    { slug: 'two', title: 'Two', pageCount: 1 },
  ]
  const context = privateReaderContext({ id: ID, title: 'My <Notes>', author: 'Ada', language: 'tr', chapterCount: 2 })

  it('fills in only the requested page and keeps the page counts', () => {
    const book = partialChapterBook(SLUG, chapters, { chapterSlug: 'one', index: 1, html: '<p>second</p>' })
    expect(book.chapters.map((c) => c.pages)).toEqual([['', '<p>second</p>'], ['']])
  })

  it('builds the reader view: My shelf, a link back to the book page and an inline cover', () => {
    const content = partialChapterBook(SLUG, chapters, { chapterSlug: 'one', index: 1, html: '<p>second</p>' })
    const view = buildReaderView(context, content, 'one', '2')
    expect(view?.book).toMatchObject({
      slug: SLUG,
      title: 'My <Notes>',
      href: `/account/books/${ID}`,
      tone: 'default',
      language: 'tr',
      collectionTitle: 'My shelf',
    })
    expect(view?.book.coverUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(view?.page).toEqual({ kind: 'chapter', html: '<p>second</p>' })
    expect(view?.canonicalPath).toBe(`/read/${SLUG}/one/2`)
    expect(view?.nav.next).toEqual({ kind: 'chapter', href: `/read/${SLUG}/two`, title: 'Two' })
    expect(context.meta.source).toMatchObject({ name: 'Imported by you', url: `/account/books/${ID}` })
    expect(context.meta.shortDescription).toBe('')
    expect(view?.book.image).toBeNull()
  })

  it('uses the book’s own cover and description when it has them', () => {
    const own = privateReaderContext({
      id: ID,
      title: 'Notes',
      author: 'Ada',
      language: 'en',
      chapterCount: 2,
      description: 'About it.',
      cover: COVER,
    })
    expect(own).toMatchObject({ bookHref: privateBookHref(ID), coverUrl: `/account/books/${ID}/cover?v=abcdef12` })
    expect(own.image).toEqual({ src: `/account/books/${ID}/cover?v=abcdef12`, width: 600, height: 900 })
    expect(own.meta.shortDescription).toBe('About it.')
  })

  it('escapes the title inside the inline cover', () => {
    const svg = decodeURIComponent(privateCoverUrl('A <script> & B', 'Ada').split(',')[1] ?? '')
    expect(svg).toContain('&lt;script&gt; &amp; B')
    expect(svg).not.toContain('<script>')
  })

  it('keeps a book’s cover style stable', () => {
    expect(privateCover('Field Notes')).toEqual(privateCover('Field Notes'))
  })
})

describe('the My shelf row', () => {
  it('links each book to its page and never to /covers', () => {
    const shelf = myShelf([{ id: ID, title: 'Field Notes', author: 'Ada', cover: null }])
    expect(shelf).toMatchObject({
      slug: 'my-shelf',
      title: 'My shelf',
      collectionSlug: 'my-shelf',
      hue: 'pink',
      hasAudio: false,
    })
    expect(shelf.books[0]).toMatchObject({ slug: SLUG, href: `/account/books/${ID}`, hasAudio: false, image: null })
    expect(shelf.books[0]?.coverUrl).not.toContain('/covers/')
  })

  it('marks an imported audiobook, and the shelf with it', () => {
    const shelf = myShelf([
      { id: ID, title: 'Heard', author: 'Ada', cover: null, format: 'audio' },
      { id: '0f8e2a9c-1b3d-4c5e-8f70-123456789abd', title: 'Read', author: 'Ada', cover: null, format: null },
    ])
    expect(shelf.hasAudio).toBe(true)
    expect(shelf.books.map((b) => b.hasAudio)).toEqual([true, false])
  })

  it('shows a book’s own cover from its account route', () => {
    const shelf = myShelf([{ id: ID, title: 'Field Notes', author: 'Ada', cover: COVER }])
    expect(shelf.books[0]?.image?.src).toBe(`/account/books/${ID}/cover?v=abcdef12`)
    expect(shelf.books[0]?.coverUrl).toBe(shelf.books[0]?.image?.src)
  })
})

describe('the Articles row', () => {
  it('is My shelf’s row under its own name, linking each card to its page', () => {
    const row = myArticles([{ id: ID, title: 'A long read', author: 'news.example', cover: null }])
    expect(row).toMatchObject({ slug: 'articles', title: 'Articles', collectionSlug: 'articles', hasAudio: false })
    expect(row.books).toMatchObject([{ slug: SLUG, title: 'A long read', href: privateBookHref(ID) }])
  })
})

describe('privateCoverImage', () => {
  it('is the cover route with the short hash, or null without a cover', () => {
    expect(privateCoverImage(ID, COVER)).toEqual({
      src: `/account/books/${ID}/cover?v=abcdef12`,
      width: 600,
      height: 900,
    })
    expect(privateCoverImage(ID, null)).toBeNull()
  })
})

describe('buildPrivateBookPage', () => {
  const base = {
    id: ID,
    title: 'Field Notes',
    author: 'Ada',
    language: 'en-GB',
    details: NO_DETAILS,
    cover: null,
    openLibraryWork: null,
    readyAt: new Date('2026-11-05T10:00:00Z'),
    chapters: [
      { slug: 'morning', title: 'Morning', pageCount: 2 },
      { slug: 'evening', title: 'Evening', pageCount: 1 },
    ],
  }

  it('says an article’s address, site, length and saving day, and is no article otherwise', () => {
    const page = buildPrivateBookPage({ ...base, articleUrl: 'https://www.news.example/a', articleWords: 1840 })
    expect(page.article).toEqual({
      url: 'https://www.news.example/a',
      site: 'news.example',
      words: 1840,
      savedAt: '2026-11-05T10:00:00.000Z',
    })
    expect(page.facts.map((f) => f.label)).toContain('Saved')
    expect(buildPrivateBookPage({ ...base, articleUrl: 'https://a.test/', articleWords: null }).article?.words).toBe(0)
    expect(buildPrivateBookPage(base).article).toBeNull()
  })

  it('counts the pictures after the chapters when the book has any', () => {
    expect(buildPrivateBookPage({ ...base, imageCount: 42 }).facts.slice(0, 2)).toEqual([
      { label: 'Chapters', value: '2' },
      { label: 'Pictures', value: '42' },
    ])
    expect(buildPrivateBookPage({ ...base, imageCount: 0 }).facts.map((f) => f.label)).not.toContain('Pictures')
  })

  it('gives the facts in order, the contents and the start, without a description', () => {
    const page = buildPrivateBookPage(base)
    expect(page.facts).toEqual([
      { label: 'Chapters', value: '2' },
      { label: 'Language', value: 'en-GB', format: 'language' },
      { label: 'Imported', value: '2026-11-05T10:00:00.000Z', format: 'date' },
    ])
    expect(page.startHref).toBe(`/read/${SLUG}/morning`)
    expect(page.toc).toEqual([
      { number: 1, title: 'Morning', href: `/read/${SLUG}/morning` },
      { number: 2, title: 'Evening', href: `/read/${SLUG}/evening` },
    ])
    expect(page).toMatchObject({
      aboutParagraphs: [],
      hasMore: false,
      image: null,
      coverSource: null,
      openLibraryUrl: null,
    })
    expect(buildPrivateBookPage({ ...base, chapters: [] }).startHref).toBe(`/read/${SLUG}`)
  })

  it('adds the ISBN, publisher and year, the cover and the Open Library link', () => {
    const details = { description: 'One.', isbn: '9780141439518', publisher: 'Penguin', publishedYear: 1813 }
    const page = buildPrivateBookPage({
      ...base,
      details,
      cover: { ...COVER, source: 'open-library' },
      openLibraryWork: 'OL66554W',
    })
    expect(page.facts.slice(3)).toEqual([
      { label: 'ISBN', value: '9780141439518' },
      { label: 'Publisher', value: 'Penguin' },
      { label: 'Published', value: '1813' },
    ])
    expect(page).toMatchObject({
      coverSource: 'open-library',
      image: { src: `/account/books/${ID}/cover?v=abcdef12` },
      openLibraryUrl: 'https://openlibrary.org/works/OL66554W',
      aboutParagraphs: ['One.'],
      hasMore: false,
    })
  })

  it('has more to read with a second paragraph or a long first one', () => {
    const two = { ...NO_DETAILS, description: 'One.\n\nTwo.' }
    expect(buildPrivateBookPage({ ...base, details: two })).toMatchObject({
      aboutParagraphs: ['One.', 'Two.'],
      hasMore: true,
    })
    const long = { ...NO_DETAILS, description: 'word '.repeat(90).trim() }
    expect(buildPrivateBookPage({ ...base, details: long }).hasMore).toBe(true)
  })
})

describe('fileSize', () => {
  it('says KB under a megabyte, one decimal under 10 MB, and whole MB above', () => {
    expect(fileSize(200)).toBe('1 KB')
    expect(fileSize(36_453)).toBe('36 KB')
    expect(fileSize(4.5 * 1024 * 1024)).toBe('4.5 MB')
    expect(fileSize(5 * 1024 * 1024)).toBe('5 MB')
    expect(fileSize(482 * 1024 * 1024 + 7)).toBe('482 MB')
  })
})

describe('buildPrivateAudiobookPage', () => {
  const base = {
    id: ID,
    title: 'Heard',
    author: 'Ada',
    narrator: 'Rex',
    language: 'en',
    details: { ...NO_DETAILS, description: 'One.\n\nTwo.', isbn: '9780141439518', publisher: 'P', publishedYear: 2020 },
    cover: COVER,
    openLibraryWork: 'OL1W',
    readyAt: new Date('2026-11-05T10:00:00Z'),
    audioMs: 41_520_000,
    audioBytes: 482 * 1024 * 1024,
    type: 'mp4' as const,
    fileCount: 1,
    chapters: [
      { position: 1, title: 'Opening', fileN: 1, startMs: 0, durationMs: 120_000 },
      { position: 2, title: 'The Storm', fileN: 1, startMs: 120_000, durationMs: 41_400_000 },
    ],
  }

  it('gives the facts in order, and the player’s book and episodes, with no pages', () => {
    const page = buildPrivateAudiobookPage(base)
    expect(page.facts.map((f) => [f.label, f.value])).toEqual([
      ['Audiobook', '11 h 32 min'],
      ['Chapters', '2'],
      ['File', 'M4B · 482 MB'],
      ['Language', 'en'],
      ['Imported', '2026-11-05T10:00:00.000Z'],
      ['ISBN', '9780141439518'],
      ['Publisher', 'P'],
      ['Published', '2020'],
    ])
    expect(page).toMatchObject({
      slug: SLUG,
      narrator: 'Rex',
      hasMore: true,
      openLibraryUrl: 'https://openlibrary.org/works/OL1W',
    })
    expect(page.player.book).toMatchObject({ slug: SLUG, href: `/account/books/${ID}`, coverUrl: page.image?.src })
    expect(page.player.episodes).toEqual([
      {
        id: '1',
        title: 'Opening',
        number: 1,
        durationMs: 120_000,
        audioUrl: `/account/books/${ID}/audio/1`,
        startMs: 0,
        pageHref: null,
      },
      {
        id: '2',
        title: 'The Storm',
        number: 2,
        durationMs: 41_400_000,
        audioUrl: `/account/books/${ID}/audio/1`,
        startMs: 120_000,
        pageHref: null,
      },
    ])
  })

  it('counts MP3 files, and goes without the optional facts and a cover', () => {
    const page = buildPrivateAudiobookPage({
      ...base,
      details: NO_DETAILS,
      cover: null,
      openLibraryWork: null,
      type: 'mp3',
      fileCount: 38,
    })
    expect(page.facts.map((f) => [f.label, f.value]).slice(0, 3)).toEqual([
      ['Audiobook', '11 h 32 min'],
      ['Chapters', '2'],
      ['Files', '38 MP3 files · 482 MB'],
    ])
    expect(page.facts).toHaveLength(5)
    expect(page.player.book.coverUrl).toMatch(/^data:image\/svg\+xml/)
    expect(page.openLibraryUrl).toBeNull()
    expect(buildPrivateAudiobookPage({ ...base, type: 'mp3', fileCount: 1 }).facts[2]).toEqual({
      label: 'File',
      value: '1 MP3 file · 482 MB',
    })
  })
})
