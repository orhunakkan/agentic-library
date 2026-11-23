import '@tanstack/react-start/server-only'
import { MAX_BOOKMARKS_PER_BOOK, MAX_BOOKMARKS_PER_USER, pageAnchor } from '~/shared/bookmarks/bookmarks'
import { pageIndexOf } from '~/shared/highlights/page-text'
import { isUuid } from '../../shared/uuid.ts'
import { noStoreJson } from '../auth.ts'
import { findBook } from '../book-ref/book.ts'
import { signedInEndpoints } from '../signed-in.ts'
import { parseBookmarkChange, parseBookmarkCreate } from './input.ts'
import { createBookmark, deleteBookmark } from './store.ts'
import { toBookmarkView } from './view.ts'

const MAX_BODY_BYTES = 2 * 1024

export type BookmarkErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'quota' | 'failed'

const bookmarks = signedInEndpoints<BookmarkErrorCode>({ maxBytes: MAX_BODY_BYTES })

export const handleBookmarkCreate = (request: Request) =>
  bookmarks.post(request, { log: 'bookmark create', parse: parseBookmarkCreate }, async ({ session, db, input }) => {
    const { fail } = bookmarks
    const book = await findBook(db, session.userId, input.book, 'text')
    if (!book) return fail(404, 'not_found')
    const pages = await book.pages()
    const page = pages[pageIndexOf(pages, input.position)]
    if (!page) return fail(400, 'invalid')
    const result = await createBookmark(db, session.userId, book.ref, {
      chapter: page.chapterSlug,
      page: page.page,
      ...pageAnchor(page.text),
    })
    if (result === 'missing') return fail(404, 'not_found')
    if (result === 'quota-book') return fail(409, 'quota', { scope: 'book', max: MAX_BOOKMARKS_PER_BOOK })
    if (result === 'quota-user') return fail(409, 'quota', { scope: 'user', max: MAX_BOOKMARKS_PER_USER })
    return noStoreJson(result.created ? 201 : 200, { bookmark: toBookmarkView(result.row, pages) })
  })

export const handleBookmarkChange = (request: Request, id: string) =>
  bookmarks.post(
    request,
    {
      log: 'bookmark change',
      before: () => (isUuid(id) ? undefined : bookmarks.fail(404, 'not_found')),
      parse: (value) => parseBookmarkChange(value) || null,
    },
    async ({ session, db }) =>
      (await deleteBookmark(db, session.userId, id))
        ? noStoreJson(200, { ok: true })
        : bookmarks.fail(404, 'not_found'),
  )
