import '@tanstack/react-start/server-only'
import { contextAt } from '~/shared/highlights/anchor'
import { pageIndexOf } from '~/shared/highlights/page-text'
import { limitsFor } from '~/shared/plans/plans'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { noStoreJson, seeOther } from '../auth.ts'
import { openBook } from '../books/book.ts'
import { refFor, slugOf } from '../books/ref.ts'
import { signedInEndpoints, signedInForm } from '../signed-in.ts'
import { parseCreate, parseUpdate } from './input.ts'
import {
  createHighlight,
  deleteForBook,
  deleteHighlight,
  getHighlight,
  isHighlightId,
  updateHighlight,
} from './store.ts'
import { toView } from './view.ts'

const MAX_CREATE_BYTES = 64 * 1024
const MAX_UPDATE_BYTES = 16 * 1024

export type HighlightErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'stale' | 'quota' | 'failed'

const highlights = signedInEndpoints<HighlightErrorCode>({ maxBytes: MAX_UPDATE_BYTES })
const { fail } = highlights

export const handleCreate = (request: Request) =>
  highlights.post(
    request,
    { log: 'highlight create', body: { json: MAX_CREATE_BYTES }, parse: parseCreate },
    async ({ session, db, input }) => {
      const { userId, plan } = session
      const book = await openBook(db, userId, input.book).then((b) => (b?.format === 'text' ? b : null))
      if (!book) return fail(404, 'not_found')
      const pages = await book.pages()
      const page = pages[pageIndexOf(pages, input.position)]
      if (!page || input.end > page.text.length) return fail(400, 'invalid')
      const context = contextAt(page.text, input.start, input.end)
      if (context.exact !== input.text) return fail(409, 'stale')
      const limits = limitsFor(plan)
      const result = await createHighlight(
        db,
        userId,
        book.ref,
        {
          chapter: page.chapterSlug,
          page: page.page,
          start: input.start,
          end: input.end,
          ...context,
          color: input.color,
          note: input.note,
        },
        { perBook: limits.highlightsPerBook, perUser: limits.highlightsPerUser },
      )
      if (result === 'missing') return fail(404, 'not_found')
      if (result === 'limit-book') return fail(409, 'quota', { scope: 'book', max: limits.highlightsPerBook, plan })
      if (result === 'limit-user') return fail(409, 'quota', { scope: 'user', max: limits.highlightsPerUser, plan })
      return noStoreJson(201, { highlight: toView(result.row, pages) })
    },
  )

export const handleChange = (request: Request, id: string) =>
  highlights.post(
    request,
    {
      log: 'highlight change',
      before: () => (isHighlightId(id) ? undefined : fail(404, 'not_found')),
      parse: parseUpdate,
    },
    async ({ session, db, input }) => {
      const { userId } = session
      if (input.intent === 'delete') {
        return (await deleteHighlight(db, userId, id)) ? noStoreJson(200, { ok: true }) : fail(404, 'not_found')
      }
      const row = await updateHighlight(db, userId, id, { color: input.color, note: input.note })
      if (!row) return fail(404, 'not_found')
      const book = await openBook(db, userId, slugOf(row.book)).then((b) => (b?.format === 'text' ? b : null))
      return noStoreJson(200, { highlight: toView(row, (await book?.pages()) ?? null) })
    },
  )

const PAGE = '/account/highlights'

export const handleHighlightsForm = (request: Request) =>
  signedInForm(request, { log: 'highlights form', next: PAGE }, async ({ session, db, form }) => {
    const intent = form.get('intent')
    const id = form.get('id')
    const slug = form.get('book')
    if (intent === 'delete' && typeof id === 'string' && isHighlightId(id)) {
      const row = await getHighlight(db, session.userId, id)
      if (!row || !(await deleteHighlight(db, session.userId, id))) return seeOther(`${PAGE}?error=missing`)
      return seeOther(`${PAGE}?book=${encodeURIComponent(slugOf(row.book))}&status=deleted`)
    }
    if (intent === 'delete-book' && isBookSlug(slug)) {
      const deleted = await deleteForBook(db, session.userId, refFor(slug))
      return seeOther(deleted ? `${PAGE}?status=deleted-book` : `${PAGE}?error=missing`)
    }
    return seeOther(`${PAGE}?error=invalid`)
  })
