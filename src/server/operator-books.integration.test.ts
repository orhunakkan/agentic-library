import { afterAll, describe, expect } from 'vitest'
import { closeDb, getDb } from '~/server/db'
import { findBooks, OperatorInputError, removeBook } from '~/server/operator-books'
import { it, raw } from './testing/db-test'
import { testUser } from './testing/users'

const db = () => getDb()
const HASH = '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA'
const REASON = 'notice 2026-12-01 from Example Press'

afterAll(async () => {
  await closeDb()
})

/** A ready book with one page and one picture, inserted directly: the import flow is tested elsewhere. */
async function bookOf(userId: number, title: string, author: string, kind: 'book' | 'audiobook' | 'article' = 'book') {
  const [book] = await raw<{ id: string }[]>`
    insert into user_books (user_id, title, author, language, status, chapter_count, ready_at, format, article_url)
    values (${userId}, ${title}, ${author}, 'en', 'ready', 1, now(),
      ${kind === 'audiobook' ? 'audio' : null}, ${kind === 'article' ? 'https://example.org/a' : null})
    returning id`
  if (!book) throw new Error('no book')
  await raw`insert into user_book_chapters (book_id, position, slug, title, pages)
    values (${book.id}, 0, 'chapter-1', 'One', ${raw.json(['<p>secret text</p>'])})`
  await raw`insert into user_book_images (book_id, n, media_type, bytes, width, height, sha256)
    values (${book.id}, 1, 'image/png', ${Buffer.from([1, 2, 3])}, 1, 1, ${'a'.repeat(64)})`
  return book.id
}

const events = () => raw<{ event: string; user_id: number | null; detail: Record<string, unknown> }[]>`
  select event, user_id::int as user_id, detail from audit_events order by id`

describe('findBooks', () => {
  it('matches title or author, ignoring case, across accounts, and never returns contents', async () => {
    const ada = await testUser(db(), 'ada', HASH)
    const bea = await testUser(db(), 'bea', HASH)
    await bookOf(ada.id, 'The Silent Sea', 'Jo Marlow')
    await bookOf(bea.id, 'Notes', 'JO MARLOW', 'audiobook')
    await bookOf(bea.id, 'Unrelated', 'Someone Else', 'article')

    const byAuthor = await findBooks(db(), 'jo marlow', REASON)
    expect(byAuthor.map((found) => [found.username, found.kind, found.title]).sort()).toEqual([
      ['ada', 'book', 'The Silent Sea'],
      ['bea', 'audiobook', 'Notes'],
    ])
    expect(Object.keys(byAuthor[0] ?? {}).sort()).toEqual(['addedAt', 'author', 'id', 'kind', 'title', 'username'])
    expect(JSON.stringify(byAuthor)).not.toContain('secret text')

    const byTitle = await findBooks(db(), 'SILENT', REASON)
    expect(byTitle.map((found) => found.title)).toEqual(['The Silent Sea'])
    expect((await findBooks(db(), 'unrelated', REASON))[0]?.kind).toBe('article')
  })

  it('treats % and _ as plain text', async () => {
    const ada = await testUser(db(), 'ada', HASH)
    await bookOf(ada.id, 'Plain', 'Author')
    expect(await findBooks(db(), '%%%', REASON)).toEqual([])
    expect(await findBooks(db(), '___', REASON)).toEqual([])
  })

  it('records book.searched with the text and the reason', async () => {
    const ada = await testUser(db(), 'ada', HASH)
    await bookOf(ada.id, 'The Silent Sea', 'Jo Marlow')
    await findBooks(db(), ' silent ', ` ${REASON} `, { via: 'books script', reason: 'not this one' })
    expect(await events()).toEqual([
      {
        event: 'book.searched',
        user_id: null,
        detail: { text: 'silent', reason: REASON, matches: 1, via: 'books script' },
      },
    ])
  })

  it('refuses an empty reason or empty text, and records nothing', async () => {
    await expect(findBooks(db(), 'silent', '  ')).rejects.toThrow(OperatorInputError)
    await expect(findBooks(db(), '', REASON)).rejects.toThrow(OperatorInputError)
    await expect(findBooks(db(), 'ab', REASON)).rejects.toThrow(/at least 3 characters/)
    expect(await events()).toEqual([])
  })
})

describe('removeBook', () => {
  it('deletes the book, its pages and its pictures, records book.removed, and returns the owner', async () => {
    const ada = await testUser(db(), 'ada', HASH)
    await raw`update users set email = 'ada@example.org', email_verified_at = now() where id = ${ada.id}`
    const bookId = await bookOf(ada.id, 'The Silent Sea', 'Jo Marlow')
    const kept = await bookOf(ada.id, 'Another', 'Jo Marlow')

    expect(await removeBook(db(), bookId, REASON)).toEqual({
      bookId,
      title: 'The Silent Sea',
      username: 'ada',
      email: 'ada@example.org',
    })
    expect(await raw`select id from user_books`).toEqual([{ id: kept }])
    expect(await raw`select book_id from user_book_chapters`).toEqual([{ book_id: kept }])
    expect(await raw`select book_id from user_book_images`).toEqual([{ book_id: kept }])
    expect(await events()).toEqual([
      {
        event: 'book.removed',
        user_id: ada.id,
        detail: { bookId, title: 'The Silent Sea', owner: 'ada', reason: REASON },
      },
    ])
  })

  it('returns no address when the owner’s address isn’t confirmed', async () => {
    const ada = await testUser(db(), 'ada', HASH)
    await raw`update users set email = 'ada@example.org' where id = ${ada.id}`
    const bookId = await bookOf(ada.id, 'The Silent Sea', 'Jo Marlow')
    expect((await removeBook(db(), bookId, REASON))?.email).toBeNull()
  })

  it('changes nothing for a missing or malformed id', async () => {
    const ada = await testUser(db(), 'ada', HASH)
    await bookOf(ada.id, 'The Silent Sea', 'Jo Marlow')
    expect(await removeBook(db(), '0b6c0000-0000-4000-8000-000000000000', REASON)).toBeNull()
    expect(await removeBook(db(), 'not-a-uuid', REASON)).toBeNull()
    expect(await raw`select count(*)::int as n from user_books`).toEqual([{ n: 1 }])
    expect(await events()).toEqual([])
  })

  it('refuses an empty reason, and changes nothing', async () => {
    const ada = await testUser(db(), 'ada', HASH)
    const bookId = await bookOf(ada.id, 'The Silent Sea', 'Jo Marlow')
    await expect(removeBook(db(), bookId, '')).rejects.toThrow(OperatorInputError)
    expect(await raw`select count(*)::int as n from user_books`).toEqual([{ n: 1 }])
  })
})
