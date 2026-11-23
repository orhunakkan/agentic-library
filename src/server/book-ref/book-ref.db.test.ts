import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAudio, findBook, labelsFor, onBook, onReadableBook, ownedBook, ownsBook } from '~/server/book-ref/book'
import type { BookRef } from '~/server/book-ref/ref'
import { closeDb, getDb } from '~/server/db'
import { deleteBook, finishImport, startImport, storeChapter } from '~/server/user-books'
import { privateBookSlug } from '~/shared/content/book-slug'
import type { AudioBook, ChapterBook } from '~/shared/content/schema'
import { bookPages } from '~/shared/highlights/page-text'
import { NO_DETAILS } from '~/shared/import/details'
import { MAX_CHAPTERS } from '~/shared/import/limits'
import { speechChapter } from '~/shared/read-aloud/speech-text'
import { readyAudiobook } from '../testing/audiobooks'
import { databaseUrl, freshDatabase } from '../testing/db'
import { testUser } from '../testing/users'

const raw = postgres(databaseUrl, { max: 1, onnotice: () => {} })
const db = () => getDb()

beforeAll(freshDatabase)
afterAll(async () => {
  await raw.end()
  await closeDb()
})
beforeEach(async () => {
  await raw`truncate users, sessions, user_books, highlights, finished_books restart identity cascade`
})

let users = 0
const newUser = () => testUser(db(), `reader-${++users}`, '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA', 'member')

const PRIDE: BookRef = { slug: 'pride-and-prejudice', userBookId: null }
const pride = () => JSON.parse(readFileSync('tests/e2e/content/books/pride-and-prejudice.json', 'utf8')) as ChapterBook

async function importBook(
  userId: number,
  chapters: { title: string; pages: string[] }[] = [{ title: 'Only', pages: ['<p>one</p>'] }],
  finish = true,
): Promise<string> {
  const start = await startImport(db(), userId, {
    title: 'Field Notes',
    author: 'Ada',
    language: 'en',
    details: NO_DETAILS,
    chapterCount: chapters.length,
  })
  if (!start.ok) throw new Error('could not start')
  for (const [i, c] of chapters.entries()) if (finish || i === 0) await storeChapter(db(), userId, start.id, i, c)
  if (finish) expect(await finishImport(db(), userId, start.id, null)).toBe('ok')
  return start.id
}

async function article(userId: number): Promise<string> {
  const [row] = await raw<{ id: string }[]>`
    insert into user_books (user_id, title, author, language, chapter_count, status, ready_at, article_url)
    values (${userId}, 'Saved', 'A. Writer', 'en', 1, 'ready', now(), 'https://news.test/a') returning id`
  await raw`insert into user_book_chapters (book_id, position, slug, title, pages)
    values (${row?.id as string}, 0, 'article', 'Saved', ${raw.json(['<p>news</p>'])})`
  return row?.id as string
}

describe('findBook', () => {
  it('gives a catalogue book its details, and its page texts in reading order', async () => {
    const user = await newUser()
    const book = await findBook(db(), user.id, 'pride-and-prejudice', 'text')
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
    const a = await findBook(db(), first.id, 'pride-and-prejudice', 'text')
    const b = await findBook(db(), second.id, 'pride-and-prejudice', 'text')
    const pages = await a?.pages()
    expect(pages?.length).toBeGreaterThan(0)
    expect(await b?.pages()).toBe(pages)
    expect(await b?.content()).toBe(await a?.content())
  })

  it('gives a private book to its owner, chapters in position order, built per request', async () => {
    const user = await newUser()
    const start = await startImport(db(), user.id, {
      title: 'Field Notes',
      author: 'Ada',
      language: 'en',
      details: NO_DETAILS,
      chapterCount: 2,
    })
    if (!start.ok) throw new Error('could not start')
    await storeChapter(db(), user.id, start.id, 1, { title: 'Evening', pages: ['<p>dusk</p>'] })
    await storeChapter(db(), user.id, start.id, 0, { title: 'Morning', pages: ['<p>dew</p>', '<p>sun</p>'] })
    expect(await finishImport(db(), user.id, start.id, null)).toBe('ok')
    const slug = privateBookSlug(start.id)

    const book = await findBook(db(), user.id, slug, 'text')
    expect(book).toMatchObject({
      slug,
      ref: { slug: null, userBookId: start.id },
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
    expect(await (await findBook(db(), user.id, slug, 'text'))?.pages()).not.toBe(pages)
  })

  it('gives null for an unknown or malformed slug, another reader’s book, one still uploading, and an audiobook under text', async () => {
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
    const heard = await readyAudiobook(raw, owner.id)
    for (const needs of ['text', 'any'] as const) {
      expect(await findBook(db(), owner.id, 'no-such-book', needs)).toBeNull()
      expect(await findBook(db(), owner.id, 'u-not-a-uuid', needs)).toBeNull()
      expect(await findBook(db(), owner.id, '../etc', needs)).toBeNull()
      expect(await findBook(db(), other.id, privateBookSlug(ready), needs)).toBeNull()
      expect(await findBook(db(), owner.id, privateBookSlug(uploading), needs)).toBeNull()
      expect(await findBook(db(), other.id, privateBookSlug(heard), needs)).toBeNull()
    }
    expect(await findBook(db(), owner.id, privateBookSlug(heard), 'text')).toBeNull()
  })

  it('finds an audiobook and an article under any, and an article under text', async () => {
    const user = await newUser()
    const heard = await readyAudiobook(raw, user.id)
    expect(await findBook(db(), user.id, privateBookSlug(heard))).toEqual({
      slug: privateBookSlug(heard),
      ref: { slug: null, userBookId: heard },
      title: 'Heard',
      author: 'Ada',
      language: 'en',
      href: `/account/books/${heard}`,
      format: 'audio',
    })
    const saved = await article(user.id)
    expect(await findBook(db(), user.id, privateBookSlug(saved))).toMatchObject({ title: 'Saved', format: 'text' })
    const text = await findBook(db(), user.id, privateBookSlug(saved), 'text')
    expect((await text?.pages())?.map((p) => p.text)).toEqual(['news'])
    expect(await findBook(db(), user.id, 'pride-and-prejudice')).toMatchObject({ ref: PRIDE, format: 'text' })
  })

  it('reads one chapter of either kind, and none past the last or past MAX_CHAPTERS', async () => {
    const user = await newUser()
    const catalogue = await findBook(db(), user.id, 'pride-and-prejudice', 'text')
    expect(await catalogue?.chapter(2)).toEqual(speechChapter(pride(), 2))
    expect(await catalogue?.chapter(pride().chapters.length)).toBeNull()
    expect(await catalogue?.chapter(-1)).toBeNull()

    const id = await importBook(user.id, [
      { title: 'Morning', pages: ['<p>dew</p>'] },
      { title: 'Evening', pages: ['<p>dusk</p>', '<p>night</p>'] },
    ])
    const own = await findBook(db(), user.id, privateBookSlug(id), 'text')
    expect(await own?.chapter(1)).toMatchObject({
      index: 1,
      title: 'Evening',
      number: 2,
      chapterCount: 2,
      pages: [{ text: 'dusk' }, { text: 'night' }],
    })
    expect(await own?.chapter(2)).toBeNull()
    expect(await own?.chapter(MAX_CHAPTERS)).toBeNull()
    expect(await own?.chapter(1.5)).toBeNull()
  })

  it('loads a private book deleted after it was found as one with no pages', async () => {
    const user = await newUser()
    const id = await importBook(user.id)
    const book = await findBook(db(), user.id, privateBookSlug(id), 'text')
    await deleteBook(db(), user.id, id)
    expect(await book?.pages()).toEqual([])
    expect(await book?.chapter(0)).toBeNull()
  })
})

describe('findAudio', () => {
  it('gives the catalogue’s audiobook or the reader’s own, and nothing for another reader’s or a text book', async () => {
    const [owner, other] = [await newUser(), await newUser()]
    const catalogue = JSON.parse(readFileSync('tests/e2e/content/audio/the-prophet.json', 'utf8')) as AudioBook
    expect((await findAudio(db(), owner.id, 'the-prophet'))?.episodes.length).toBe(catalogue.episodes.length)
    expect(await findAudio(db(), owner.id, 'pride-and-prejudice')).toBeNull()
    const heard = await readyAudiobook(raw, owner.id, [60_000, 90_000])
    const own = await findAudio(db(), owner.id, privateBookSlug(heard))
    expect(own?.bookSlug).toBe(privateBookSlug(heard))
    expect(own?.episodes.map((e) => [e.id, e.durationMs])).toEqual([
      ['1', 60_000],
      ['2', 90_000],
    ])
    expect(await findAudio(db(), other.id, privateBookSlug(heard))).toBeNull()
    expect(await findAudio(db(), owner.id, privateBookSlug(await importBook(owner.id)))).toBeNull()
    expect(await findAudio(db(), owner.id, 'u-not-a-uuid')).toBeNull()
  })
})

describe('labelsFor', () => {
  it('labels catalogue books, a removed one and the reader’s private books, and leaves out another reader’s', async () => {
    const [owner, other] = [await newUser(), await newUser()]
    const mine = await importBook(owner.id)
    const theirs = await importBook(other.id)
    const labels = await labelsFor(db(), owner.id, [
      PRIDE,
      { slug: 'gone-book', userBookId: null },
      { slug: null, userBookId: mine },
      { slug: null, userBookId: theirs },
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

describe('the SQL for rows about a book', () => {
  it('checks a private book inside the transaction that writes, against a book deleted mid-request', async () => {
    const user = await newUser()
    const id = await importBook(user.id)
    const ref: BookRef = { slug: null, userBookId: id }
    expect(await findBook(db(), user.id, privateBookSlug(id))).not.toBeNull()
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
      select 1 from finished_books where user_id = ${owner.id} and ${onBook(db(), { slug: null, userBookId: mine })}`
    expect(inMine).toHaveLength(1)
    expect(() => onReadableBook(db(), owner.id, 'f; drop table users')).toThrow('not a table alias')
  })
})
