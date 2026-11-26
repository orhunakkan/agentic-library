import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { newCover, setCover } from '~/server/book-details/store'
import {
  insertCapped,
  labelsFor,
  onBook,
  onBookConflict,
  onReadableBook,
  openBook,
  ownedBook,
  ownsBook,
} from '~/server/books/book'
import { type BookRef, refFor } from '~/server/books/ref'
import { closeDb, getDb } from '~/server/db'
import { catalogueVersion } from '~/server/downloads/version'
import { catalogueBook, loadCatalog } from '~/server/repository'
import { deleteBook, finishImport, startImport, storeChapter } from '~/server/user-books'
import { buildBookPage } from '~/shared/content/book-page'
import { IN_BOOK_HIT_LIMIT } from '~/shared/content/book-search'
import { privateBookSlug } from '~/shared/content/book-slug'
import type { AudioBook, ChapterBook } from '~/shared/content/schema'
import { bookPages } from '~/shared/highlights/page-text'
import { NO_DETAILS } from '~/shared/import/details'
import { sniffImage } from '~/shared/import/image'
import { MAX_CHAPTERS } from '~/shared/import/limits'
import { DEFAULT_LIMITS } from '~/shared/limits/limits'
import { speechChapter } from '~/shared/read-aloud/speech-text'
import { readyAudiobook } from '../testing/audiobooks'
import { databaseUrl, freshDatabase } from '../testing/db'
import { testUser } from '../testing/users'

const missing = vi.hoisted(() => ({ content: new Set<string>() }))
vi.mock('~/server/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/server/repository')>()
  return {
    ...actual,
    loadBook: (slug: string) => (missing.content.has(slug) ? Promise.resolve(null) : actual.loadBook(slug)),
  }
})

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, user_books, highlights, finished_books, flashcards, book_ratings, listening_places restart identity cascade`
})

let users = 0
const newUser = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const PRIDE = refFor('pride-and-prejudice')
const pride = () =>
  JSON.parse(readFileSync('tests/fixtures/content/books/pride-and-prejudice.json', 'utf8')) as ChapterBook

async function importBook(
  userId: number,
  chapters: { title: string; pages: string[] }[] = [{ title: 'Only', pages: ['<p>one</p>'] }],
  finish = true,
): Promise<string> {
  const start = await startImport(
    db(),
    userId,
    {
      title: 'Field Notes',
      author: 'Ada',
      language: 'en',
      details: NO_DETAILS,
      chapterCount: chapters.length,
    },
    new Date(),
    DEFAULT_LIMITS,
  )
  if (!start.ok) throw new Error('could not start')
  for (const [i, c] of chapters.entries())
    if (finish || i === 0) await storeChapter(db(), userId, start.id, i, c, DEFAULT_LIMITS)
  if (finish) expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  return start.id
}

async function textBook(userId: number | null, slug: string) {
  const book = await openBook(db(), userId, slug)
  if (book?.format !== 'text') throw new Error(`${slug} does not open as a text book`)
  return book
}

async function article(userId: number): Promise<string> {
  const [row] = await raw<{ id: string }[]>`
    insert into user_books (user_id, title, author, language, chapter_count, status, ready_at, article_url)
    values (${userId}, 'Saved', 'A. Writer', 'en', 1, 'ready', now(), 'https://news.test/a') returning id`
  await raw`insert into user_book_chapters (book_id, position, slug, title, pages)
    values (${row?.id as string}, 0, 'article', 'Saved', ${raw.json(['<p>news</p>'])})`
  return row?.id as string
}

describe('openBook', () => {
  it('opens a catalogue book for anyone, signed in or signed out', async () => {
    const user = await newUser()
    for (const reader of [null, user.id]) {
      expect(await openBook(db(), reader, 'pride-and-prejudice')).toMatchObject({
        slug: 'pride-and-prejudice',
        ref: PRIDE,
        title: 'Pride and Prejudice',
        author: 'Jane Austen',
        language: 'en-GB',
        href: '/library/jane-austen/pride-and-prejudice',
        format: 'text',
      })
    }
  })

  it('opens a private book for its owner only, once its import has finished', async () => {
    const [owner, other] = [await newUser(), await newUser()]
    const ready = await importBook(owner.id)
    const uploading = await importBook(
      owner.id,
      [
        { title: 'One', pages: ['<p>one</p>'] },
        { title: 'Two', pages: [] },
      ],
      false,
    )
    expect(await openBook(db(), owner.id, privateBookSlug(ready))).toMatchObject({
      slug: privateBookSlug(ready),
      ref: refFor(privateBookSlug(ready)),
      title: 'Field Notes',
      author: 'Ada',
      language: 'en',
      href: `/account/books/${ready}`,
      format: 'text',
    })
    expect(await openBook(db(), null, privateBookSlug(ready))).toBeNull()
    expect(await openBook(null, null, privateBookSlug(ready))).toBeNull()
    expect(await openBook(db(), other.id, privateBookSlug(ready))).toBeNull()
    expect(await openBook(db(), owner.id, privateBookSlug(uploading))).toBeNull()
  })

  it('opens nothing for an unknown or malformed book slug', async () => {
    const user = await newUser()
    for (const reader of [null, user.id]) {
      for (const slug of ['no-such-book', 'u-not-a-uuid', 'u-', '../etc']) {
        expect(await openBook(db(), reader, slug)).toBeNull()
      }
    }
    const slug = privateBookSlug(await importBook(user.id))
    for (const mangled of [slug.slice(2), slug.toUpperCase().replace(/^U-/, 'u-'), `${slug}0`]) {
      expect(await openBook(db(), user.id, mangled), mangled).toBeNull()
    }
  })

  it('opens nothing for a catalogue book whose content is missing', async () => {
    missing.content.add('pride-and-prejudice')
    try {
      expect(await openBook(db(), null, 'pride-and-prejudice')).toBeNull()
    } finally {
      missing.content.clear()
    }
  })

  it('opens a private audiobook as audio, with its episodes and no text', async () => {
    const [owner, other] = [await newUser(), await newUser()]
    const heard = await readyAudiobook(raw, owner.id, [60_000, 90_000])
    const book = await openBook(db(), owner.id, privateBookSlug(heard))
    expect(book).toMatchObject({ slug: privateBookSlug(heard), title: 'Heard', format: 'audio' })
    expect(book && 'content' in book).toBe(false)
    const audio = await book?.audio()
    expect(audio?.bookSlug).toBe(privateBookSlug(heard))
    expect(audio?.episodes.map((e) => [e.id, e.durationMs])).toEqual([
      ['1', 60_000],
      ['2', 90_000],
    ])
    expect(await openBook(db(), other.id, privateBookSlug(heard))).toBeNull()
    expect(await openBook(db(), null, privateBookSlug(heard))).toBeNull()
  })

  it('gives a catalogue audiobook its episodes, and a book without one no audio', async () => {
    const user = await newUser()
    const catalogue = JSON.parse(readFileSync('tests/fixtures/content/audio/the-prophet.json', 'utf8')) as AudioBook
    for (const reader of [null, user.id]) {
      const prophet = await openBook(db(), reader, 'the-prophet')
      expect((await prophet?.audio())?.episodes.length).toBe(catalogue.episodes.length)
      expect(await (await openBook(db(), reader, 'pride-and-prejudice'))?.audio()).toBeNull()
    }
    const own = await openBook(db(), user.id, privateBookSlug(await importBook(user.id)))
    expect(await own?.audio()).toBeNull()
  })
})

describe('a text book', () => {
  it('gives a catalogue book its details, and its page texts in reading order', async () => {
    const user = await newUser()
    const book = await textBook(user.id, 'pride-and-prejudice')
    expect(book).toMatchObject({
      slug: 'pride-and-prejudice',
      ref: PRIDE,
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      href: '/library/jane-austen/pride-and-prejudice',
      format: 'text',
    })
    const pages = await book?.pages()
    expect(pages).toEqual(bookPages(pride()))
    expect(pages?.[0]?.chapterIndex).toBe(0)
    expect(pages?.at(-1)?.chapterIndex).toBe(pride().chapters.length - 1)
    expect(await book?.content()).toEqual(pride())
  })

  it('builds a catalogue book once per slug, for every user', async () => {
    const [first, second] = [await newUser(), await newUser()]
    const a = await textBook(first.id, 'pride-and-prejudice')
    const b = await textBook(second.id, 'pride-and-prejudice')
    const pages = await a?.pages()
    expect(pages?.length).toBeGreaterThan(0)
    expect(await b?.pages()).toBe(pages)
    expect(await b?.content()).toBe(await a?.content())
  })

  it('gives a private book to its owner, chapters in position order, built per request', async () => {
    const user = await newUser()
    const start = await startImport(
      db(),
      user.id,
      {
        title: 'Field Notes',
        author: 'Ada',
        language: 'en',
        details: NO_DETAILS,
        chapterCount: 2,
      },
      new Date(),
      DEFAULT_LIMITS,
    )
    if (!start.ok) throw new Error('could not start')
    await storeChapter(db(), user.id, start.id, 1, { title: 'Evening', pages: ['<p>dusk</p>'] }, DEFAULT_LIMITS)
    await storeChapter(
      db(),
      user.id,
      start.id,
      0,
      { title: 'Morning', pages: ['<p>dew</p>', '<p>sun</p>'] },
      DEFAULT_LIMITS,
    )
    expect(await finishImport(db(), user.id, start.id, null)).toBe('ok')
    const slug = privateBookSlug(start.id)

    const book = await textBook(user.id, slug)
    expect(book).toMatchObject({
      slug,
      ref: refFor(slug),
      title: 'Field Notes',
      author: 'Ada',
      language: 'en',
      href: `/account/books/${start.id}`,
      format: 'text',
    })
    const pages = await book?.pages()
    expect(pages?.map((p) => [p.chapterTitle, p.page, p.text])).toEqual([
      ['Morning', 1, 'dew'],
      ['Morning', 2, 'sun'],
      ['Evening', 1, 'dusk'],
    ])
    expect(await book?.pages()).toBe(pages)
    expect(await (await textBook(user.id, slug))?.pages()).not.toBe(pages)
  })

  it('opens a saved article as a text book', async () => {
    const user = await newUser()
    const saved = await article(user.id)
    const text = await textBook(user.id, privateBookSlug(saved))
    expect(text).toMatchObject({ title: 'Saved', format: 'text' })
    expect((await text.pages()).map((p) => p.text)).toEqual(['news'])
  })

  it('gives one chapter to read aloud, with the book as the dock shows it, for either kind', async () => {
    const user = await newUser()
    const catalogue = await textBook(null, 'pride-and-prejudice')
    const third = await catalogue.speechChapter(2)
    expect(third?.book).toMatchObject({
      slug: 'pride-and-prejudice',
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      href: '/library/jane-austen/pride-and-prejudice',
      language: 'en-GB',
    })
    expect(third?.book.coverUrl).toMatch(/^\/covers\/pride-and-prejudice-[0-9a-f]{8}\.jpg$/)
    expect(third?.book.chapterTitles.slice(0, 2)).toEqual(['Chapter 1', 'Chapter 2'])
    expect(third?.chapter).toEqual(speechChapter(pride(), 2))

    const id = await importBook(user.id, [
      { title: 'Morning', pages: ['<p>dew on the grass</p>', '<p>two</p>'] },
      { title: 'Evening', pages: ['<p>dusk</p>'] },
    ])
    const slug = privateBookSlug(id)
    const first = await (await textBook(user.id, slug)).speechChapter(0)
    expect(first?.book).toMatchObject({
      slug,
      title: 'Field Notes',
      author: 'Ada',
      language: 'en',
      href: `/account/books/${id}`,
      chapterTitles: ['Morning', 'Evening'],
    })
    expect(first?.book.coverUrl).toMatch(/^data:image\/svg\+xml/)
    expect(first?.chapter).toMatchObject({ index: 0, slug: 'morning', title: 'Morning', number: 1, chapterCount: 2 })
    expect(first?.chapter.pages.map((p) => [p.href, p.label, p.text])).toEqual([
      [`/read/${slug}/morning`, 'Ch. 1 · p. 1', 'dew on the grass'],
      [`/read/${slug}/morning/2`, 'Ch. 1 · p. 2', 'two'],
    ])
  })

  it('gives no chapter past the last, past MAX_CHAPTERS, negative or not whole, for either kind', async () => {
    const user = await newUser()
    const catalogue = await textBook(null, 'pride-and-prejudice')
    const own = await textBook(user.id, privateBookSlug(await importBook(user.id)))
    for (const [book, count] of [
      [catalogue, pride().chapters.length],
      [own, 1],
    ] as const) {
      for (const index of [count, MAX_CHAPTERS, -1, 0.5]) expect(await book.speechChapter(index)).toBeNull()
    }
  })

  it('gives a catalogue reader page, with its offline version and the audiobook the book page shows', async () => {
    for (const reader of [null, (await newUser()).id]) {
      const pridePage = await (await textBook(reader, 'pride-and-prejudice')).readerPage('chapter-1', undefined)
      expect(pridePage?.view.book).toMatchObject({ slug: 'pride-and-prejudice', title: 'Pride and Prejudice' })
      expect(pridePage?.view.chapterTitle).toBe('Chapter 1')
      expect(pridePage?.cover).toEqual((await catalogueBook('pride-and-prejudice'))?.cover)
      expect(pridePage?.audio).toBeNull()
      expect(pridePage?.offlineVersion).toBe(await catalogueVersion('pride-and-prejudice'))
      expect(
        (await (await textBook(reader, 'pride-and-prejudice')).readerPage('chapter-1', '2'))?.view.page,
      ).not.toEqual(pridePage?.view.page)
    }
    const prophet = await textBook(null, 'the-prophet')
    const content = await prophet.content()
    const first = content.kind === 'chapter' ? content.chapters[0]?.slug : undefined
    const meta = await catalogueBook('the-prophet')
    if (!first || !meta) throw new Error('the-prophet fixture changed')
    const bookPage = buildBookPage(await loadCatalog(), content, await prophet.audio(), meta.seriesSlug, meta.slug)
    expect(bookPage?.audio).not.toBeNull()
    expect((await prophet.readerPage(first, undefined))?.audio).toEqual(bookPage?.audio)
  })

  it('gives a private reader page, loading the one page asked for, with its cover and offline version', async () => {
    const user = await newUser()
    const id = await importBook(user.id, [
      { title: 'Morning', pages: ['<p>dew on the grass</p>', '<p>two</p>'] },
      { title: 'Evening', pages: ['<p>dusk</p>'] },
    ])
    const slug = privateBookSlug(id)
    const book = await textBook(user.id, slug)
    const first = await book.readerPage('morning', undefined)
    expect(first?.view.book).toMatchObject({ slug, title: 'Field Notes', author: 'Ada', href: `/account/books/${id}` })
    expect(first?.view.book.coverUrl).toMatch(/^data:image\/svg\+xml/)
    expect(first?.view.chapterTitle).toBe('Morning')
    expect(first?.view.page).toEqual({ kind: 'chapter', html: '<p>dew on the grass</p>' })
    expect(first?.audio).toBeNull()
    expect(first?.offlineVersion).toMatch(/^[0-9a-f]{16}$/)
    expect((await book.readerPage('morning', '2'))?.view.page).toEqual({ kind: 'chapter', html: '<p>two</p>' })
    const evening = await book.readerPage('evening', undefined)
    expect(evening?.view.chapterTitle).toBe('Evening')
    expect(evening?.offlineVersion).toBe(first?.offlineVersion)

    const bytes = new Uint8Array(readFileSync('tests/fixtures/images/cover.jpg'))
    await setCover(
      db(),
      user.id,
      id,
      newCover(bytes, sniffImage(bytes) as NonNullable<ReturnType<typeof sniffImage>>, 'upload'),
    )
    const covered = await book.readerPage('morning', undefined)
    expect(covered?.view.book.coverUrl).toMatch(new RegExp(`^/account/books/${id}/cover\\?v=[0-9a-f]{8}$`))
    expect(covered?.view.book.image).toMatchObject({ width: 400, height: 600 })
    expect(covered?.offlineVersion).not.toBe(first?.offlineVersion)
    expect((await book.speechChapter(0))?.book.image?.src).toBe(covered?.view.book.coverUrl)
  })

  it.each([
    ['page 1 spelled out (page one has no number)', 'morning', '1'],
    ['page 0', 'morning', '0'],
    ['a leading zero', 'morning', '02'],
    ['past the last page', 'morning', '3'],
    ['far past any chapter', 'morning', '100001'],
    ['not a number', 'morning', 'two'],
    ['a chapter that is not there', 'midnight', undefined],
  ])('gives no private reader page for %s', async (_name, part, n) => {
    const user = await newUser()
    const id = await importBook(user.id, [{ title: 'Morning', pages: ['<p>one</p>', '<p>two</p>'] }])
    expect(await (await textBook(user.id, privateBookSlug(id))).readerPage(part, n)).toBeNull()
  })

  it.each([
    ['page 1 spelled out', 'chapter-1', '1'],
    ['far past any chapter', 'chapter-1', '100001'],
    ['not a number', 'chapter-1', 'two'],
    ['a chapter that is not there', 'midnight', undefined],
  ])('gives no catalogue reader page for %s', async (_name, part, n) => {
    expect(await (await textBook(null, 'pride-and-prejudice')).readerPage(part, n)).toBeNull()
  })

  it('searches the text of either kind of book', async () => {
    const user = await newUser()
    const catalogue = await textBook(null, 'pride-and-prejudice')
    const hits = await catalogue.search('universally acknowledged')
    expect(hits.map((h) => [h.chapterTitle, h.href])).toEqual([['Chapter 1', '/read/pride-and-prejudice/chapter-1']])
    expect((await catalogue.search('the')).length).toBe(IN_BOOK_HIT_LIMIT)

    const id = await importBook(user.id, [
      { title: 'Morning', pages: ['<p>dew on the grass</p>'] },
      { title: 'Evening', pages: ['<p>the grass at dusk</p>'] },
    ])
    const own = await textBook(user.id, privateBookSlug(id))
    expect((await own.search('grass')).map((h) => h.chapterTitle)).toEqual(['Morning', 'Evening'])
    expect(await own.search('nowhere')).toEqual([])
  })

  it('gives a catalogue offline copy to anyone, built once, at the version its reader page names', async () => {
    const user = await newUser()
    const book = await textBook(null, 'pride-and-prejudice')
    const signedOut = await book.offlineCopy()
    expect(signedOut).toMatchObject({ v: 1, slug: 'pride-and-prejudice', title: 'Pride and Prejudice', owner: null })
    expect(signedOut?.content).toEqual(pride())
    expect(signedOut?.version).toBe((await book.readerPage('chapter-1', undefined))?.offlineVersion)
    expect(await (await textBook(user.id, 'pride-and-prejudice')).offlineCopy()).toBe(signedOut)
  })

  it('gives a private offline copy, whole, naming its owner, at the version its reader page names', async () => {
    const owner = await newUser()
    const id = await importBook(owner.id, [
      { title: 'Morning', pages: ['<p>dew</p>', '<p>two</p>'] },
      { title: 'Evening', pages: ['<p>dusk</p>'] },
    ])
    const book = await textBook(owner.id, privateBookSlug(id))
    const copy = await book.offlineCopy()
    expect(copy).toMatchObject({ v: 1, slug: privateBookSlug(id), title: 'Field Notes', owner: owner.username })
    expect(copy?.content.chapters.map((c) => c.title)).toEqual(['Morning', 'Evening'])
    expect(copy?.speech).toMatchObject({ slug: privateBookSlug(id), chapterTitles: ['Morning', 'Evening'] })
    expect(copy?.version).toBe((await book.readerPage('evening', undefined))?.offlineVersion)
  })

  it('loads a private book deleted after it was found as one with no pages', async () => {
    const user = await newUser()
    const id = await importBook(user.id)
    const book = await textBook(user.id, privateBookSlug(id))
    await deleteBook(db(), user.id, id)
    expect(await book?.pages()).toEqual([])
    expect(await book?.speechChapter(0)).toBeNull()
    expect(await book?.readerPage('only', undefined)).toBeNull()
    expect(await book?.offlineCopy()).toBeNull()
  })
})

describe('labelsFor', () => {
  it('labels catalogue books, a removed one and the reader’s private books, and leaves out another reader’s', async () => {
    const [owner, other] = [await newUser(), await newUser()]
    const mine = await importBook(owner.id)
    const theirs = await importBook(other.id)
    const labels = await labelsFor(db(), owner.id, [
      PRIDE,
      refFor('gone-book'),
      refFor(privateBookSlug(mine)),
      refFor(privateBookSlug(theirs)),
    ])
    expect(Object.fromEntries(labels)).toEqual({
      'pride-and-prejudice': {
        title: 'Pride and Prejudice',
        author: 'Jane Austen',
        href: '/library/jane-austen/pride-and-prejudice',
        removed: false,
      },
      'gone-book': { title: 'A book no longer in the library', author: '', href: null, removed: true },
      [privateBookSlug(mine)]: { title: 'Field Notes', author: 'Ada', href: `/account/books/${mine}`, removed: false },
    })
    expect(await labelsFor(db(), owner.id, [])).toEqual(new Map())
  })
})

describe('insertCapped', () => {
  const card = (front: string) => ({ chapter: null, page: 1, front, back: 'b', origin: 'manual' })
  const save = (userId: number, book: BookRef, front: string, limits = { perBook: 3, perUser: 5 }) =>
    insertCapped(db(), userId, book, {
      table: 'flashcards',
      limits,
      values: card(front),
      returning: ['id', 'front'],
      same: ['front'],
      toRow: (r) => ({ id: r.id, front: r.front }),
    })

  it('type-check every column a caller names against its table', () => {
    /** Never run: tsc checks these calls. */
    const typed = (userId: number, book: BookRef) => [
      insertCapped(db(), userId, book, {
        table: 'bookmarks',
        limits: { perBook: 1, perUser: 1 },
        // @ts-expect-error a column the table doesn't have
        values: { chpater: null, page: 1 },
        returning: ['id'],
        toRow: (r) => r.id,
      }),
      insertCapped(db(), userId, book, {
        table: 'bookmarks',
        limits: { perBook: 1, perUser: 1 },
        values: { chapter: null, page: 1 },
        returning: ['id'],
        // @ts-expect-error a column that isn't in the values
        same: ['chapter', 'exact'],
        toRow: (r) => r.id,
      }),
      insertCapped(db(), userId, book, {
        table: 'bookmarks',
        limits: { perBook: 1, perUser: 1 },
        values: { chapter: null, page: 1 },
        // @ts-expect-error a column of another table
        returning: ['id', 'front'],
        toRow: (r) => r.id,
      }),
      insertCapped(db(), userId, book, {
        table: 'bookmarks',
        limits: { perBook: 1, perUser: 1 },
        values: { chapter: null, page: 1 },
        returning: ['id'],
        // @ts-expect-error a column it didn't ask for
        toRow: (r) => r.page,
      }),
    ]
    expect(typeof typed).toBe('function')
  })
  const fill = (userId: number, book: BookRef, n: number) => raw`
    insert into flashcards (user_id, book_slug, user_book_id, chapter, page, front, back, origin)
    select ${userId}, ${book.slug}, ${book.userBookId}, null, 1, 'filled ' || n, 'b', 'manual'
    from generate_series(1, ${n}) n`

  it('writes a row on either kind of book, and refuses a book that is not the reader’s', async () => {
    const [owner, other] = [await newUser(), await newUser()]
    const mine = refFor(privateBookSlug(await importBook(owner.id)))
    expect(await save(owner.id, PRIDE, 'one')).toMatchObject({ row: { front: 'one' }, created: true })
    expect(await save(owner.id, mine, 'one')).toMatchObject({ row: { front: 'one' }, created: true })
    expect(await save(other.id, mine, 'two')).toBe('missing')
  })

  it('answers the row already there instead of writing the same one twice, even in parallel', async () => {
    const user = await newUser()
    const first = await save(user.id, PRIDE, 'same')
    expect(await save(user.id, PRIDE, 'same')).toEqual(typeof first === 'object' ? { ...first, created: false } : null)
    const raced = await Promise.all([save(user.id, PRIDE, 'raced'), save(user.id, PRIDE, 'raced')])
    expect(raced.map((r) => typeof r === 'object' && r.created).sort()).toEqual([false, true])
  })

  it('checks the per-book cap before the per-user cap', async () => {
    const user = await newUser()
    await fill(user.id, PRIDE, 3)
    await fill(user.id, refFor('fixture-code-book'), 2)
    expect(await save(user.id, PRIDE, 'over both')).toBe('limit-book')
    expect(await save(user.id, refFor('another-book'), 'over the user')).toBe('limit-user')
  })

  it('lets only one of two parallel inserts take the last slot', async () => {
    const user = await newUser()
    await fill(user.id, PRIDE, 2)
    const results = await Promise.all([save(user.id, PRIDE, 'a'), save(user.id, PRIDE, 'b')])
    expect(results.filter((r) => r === 'limit-book')).toHaveLength(1)
    expect(results.filter((r) => typeof r === 'object')).toHaveLength(1)
  })
})

describe('onBookConflict', () => {
  const rate = (userId: number, ref: BookRef, stars: number) => db()`
    insert into book_ratings (user_id, book_slug, user_book_id, stars)
    values (${userId}, ${ref.slug}, ${ref.userBookId}, ${stars})
    on conflict ${onBookConflict(db(), ref)} do update set stars = excluded.stars`
  const listen = (userId: number, ref: BookRef, positionMs: number) => db()`
    insert into listening_places (user_id, book_slug, user_book_id, kind, episode, position_ms, at, device)
    values (${userId}, ${ref.slug}, ${ref.userBookId}, 'episode', 'one', ${positionMs}, now(), 'test')
    on conflict ${onBookConflict(db(), ref, { keys: ['episode'], where: db()`kind = 'episode'` })}
    do update set position_ms = excluded.position_ms`

  it('updates the one row for a book, of either kind, instead of adding a second', async () => {
    const user = await newUser()
    const mine = refFor(privateBookSlug(await importBook(user.id)))
    for (const ref of [PRIDE, mine]) {
      await rate(user.id, ref, 2)
      await rate(user.id, ref, 5)
      await listen(user.id, ref, 10)
      await listen(user.id, ref, 20)
    }
    const ratings = await raw<{ stars: number }[]>`select stars from book_ratings where user_id = ${user.id}`
    expect(ratings.map((r) => r.stars)).toEqual([5, 5])
    const places = await raw<{ position_ms: number }[]>`
      select position_ms from listening_places where user_id = ${user.id}`
    expect(places.map((r) => r.position_ms)).toEqual([20, 20])
  })
})

describe('the SQL for rows about a book', () => {
  it('checks a private book inside the transaction that writes, against a book deleted mid-request', async () => {
    const user = await newUser()
    const id = await importBook(user.id)
    const ref = refFor(privateBookSlug(id))
    expect(await openBook(db(), user.id, privateBookSlug(id))).not.toBeNull()
    await deleteBook(db(), user.id, id)
    const written = await db().begin(async (tx) => {
      expect(await ownsBook(tx, user.id, ref)).toBe(false)
      expect(await ownsBook(tx, user.id, PRIDE)).toBe(true)
      return tx`
        insert into finished_books (user_id, book_slug, user_book_id)
        select ${user.id}::bigint, null, ${id}::uuid where ${ownedBook(tx, user.id, ref)} returning 1`
    })
    expect(written).toHaveLength(0)
  })

  it('finds rows in one book, and only the rows a reader may still read', async () => {
    const [owner, other] = [await newUser(), await newUser()]
    const mine = await importBook(owner.id)
    const uploading = await importBook(
      owner.id,
      [
        { title: 'One', pages: ['<p>one</p>'] },
        { title: 'Two', pages: [] },
      ],
      false,
    )
    const theirs = await importBook(other.id)
    for (const [slug, bookId] of [
      ['pride-and-prejudice', null],
      [null, mine],
      [null, uploading],
      [null, theirs],
    ] as const) {
      await raw`insert into finished_books (user_id, book_slug, user_book_id) values (${owner.id}, ${slug}, ${bookId})`
    }
    const readable = await db()<{ book_slug: string | null; user_book_id: string | null }[]>`
      select f.book_slug, f.user_book_id from finished_books f
      where f.user_id = ${owner.id} and ${onReadableBook(db(), owner.id, 'f')}
      order by f.book_slug nulls last`
    expect(readable).toEqual([
      { book_slug: 'pride-and-prejudice', user_book_id: null },
      { book_slug: null, user_book_id: mine },
    ])
    const inMine = await db()`
      select 1 from finished_books where user_id = ${owner.id} and ${onBook(db(), refFor(privateBookSlug(mine)))}`
    expect(inMine).toHaveLength(1)
    expect(() => onReadableBook(db(), owner.id, 'f; drop table users')).toThrow('not a table alias')
  })
})
