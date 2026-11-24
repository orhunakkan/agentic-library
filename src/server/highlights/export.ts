import '@tanstack/react-start/server-only'
import {
  type ExportAllBook,
  exportAllFileName,
  exportFileName,
  toMarkdown,
  toMarkdownAll,
} from '~/shared/highlights/markdown'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { NO_STORE, noStoreText, sessionForRequest, toSignIn } from '../auth.ts'
import { openBook } from '../books/book.ts'
import { slugOf } from '../books/ref.ts'
import { getConfig } from '../config.ts'
import { getDb, isDatabaseConfigured } from '../db.ts'
import { requireProText } from '../plans/plan.ts'
import { logError } from '../redact.ts'
import { highlightsFor, resolvedHighlights } from './resolve.ts'
import { bookSummaries } from './store.ts'

const FAILED = 'Something went wrong. Try again in a few minutes.'

const attachment = (markdown: string, fileName: string) =>
  new Response(markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': NO_STORE,
    },
  })

export async function handleExport(request: Request, slug: string): Promise<Response> {
  if (!isBookSlug(slug)) return noStoreText(404, 'Not found')
  const session = isDatabaseConfigured() ? await sessionForRequest(request) : null
  if (!session) return toSignIn(`/account/highlights?book=${slug}`)
  const notPro = requireProText(session, 'export')
  if (notPro) return notPro
  try {
    const db = getDb()
    const book = await openBook(db, session.userId, slug).then((b) => (b?.format === 'text' ? b : null))
    if (!book) return noStoreText(404, 'Not found')
    const highlights = await resolvedHighlights(db, session.userId, book)
    const markdown = toMarkdown({ slug, title: book.title, author: book.author }, highlights, {
      origin: getConfig().appOrigin,
      now: new Date(),
    })
    return attachment(markdown, exportFileName(slug, book.title))
  } catch (error) {
    logError('highlights export', error)
    return noStoreText(500, FAILED)
  }
}

export async function handleExportAll(request: Request): Promise<Response> {
  const session = isDatabaseConfigured() ? await sessionForRequest(request) : null
  if (!session) return toSignIn('/account/highlights')
  const notPro = requireProText(session, 'export')
  if (notPro) return notPro
  try {
    const db = getDb()
    const books: ExportAllBook[] = []
    for (const summary of await bookSummaries(db, session.userId)) {
      const found = await highlightsFor(db, session.userId, slugOf(summary.book))
      if (found) books.push({ ...found.book, highlights: found.highlights })
    }
    const now = new Date()
    return attachment(toMarkdownAll(books, { origin: getConfig().appOrigin, now }), exportAllFileName(now))
  } catch (error) {
    logError('highlights export all', error)
    return noStoreText(500, FAILED)
  }
}
