import '@tanstack/react-start/server-only'
import { MAX_CARDS_PER_BOOK, MAX_CARDS_PER_USER } from '~/shared/flashcards/limits'
import { pageIndexOf } from '~/shared/highlights/page-text'
import { isBookSlug } from '../../shared/content/book-slug.ts'
import { isUuid } from '../../shared/uuid.ts'
import { noStoreJson, seeOther } from '../auth.ts'
import { openBook } from '../books/book.ts'
import { refFor, slugOf } from '../books/ref.ts'
import { requirePro } from '../plans/plan.ts'
import { signedInEndpoints, signedInForm } from '../signed-in.ts'
import { parseCardChange, parseNewCard } from './input.ts'
import { deleteBookCards, deleteCard, reviewCard, saveCard } from './store.ts'
import { toCardView } from './view.ts'

const MAX_BODY_BYTES = 8 * 1024

export type FlashcardErrorCode = 'signed_out' | 'not_found' | 'invalid' | 'quota' | 'failed'

const cards = signedInEndpoints<FlashcardErrorCode>({ maxBytes: MAX_BODY_BYTES })
const { fail } = cards

export const handleCardSave = (request: Request) =>
  cards.post(
    request,
    {
      log: 'flashcard save',
      before: ({ session }) => requirePro(session, 'flashcards') ?? undefined,
      parse: parseNewCard,
    },
    async ({ session, db, input }) => {
      const { userId } = session
      const book = await openBook(db, userId, input.book).then((b) => (b?.format === 'text' ? b : null))
      if (!book) return fail(404, 'not_found')
      const pages = await book.pages()
      const page = pages[pageIndexOf(pages, input.position)]
      if (!page) return fail(400, 'invalid')
      const result = await saveCard(db, userId, book.ref, {
        chapter: page.chapterSlug,
        page: page.page,
        front: input.front,
        back: input.back,
        origin: input.origin,
      })
      if (result === 'missing') return fail(404, 'not_found')
      if (result === 'quota-book') return fail(409, 'quota', { scope: 'book', max: MAX_CARDS_PER_BOOK })
      if (result === 'quota-user') return fail(409, 'quota', { scope: 'user', max: MAX_CARDS_PER_USER })
      return noStoreJson(result.existed ? 200 : 201, {
        card: toCardView(result.row, pages),
        existed: result.existed,
      })
    },
  )

export const handleCardChange = (request: Request, id: string) =>
  cards.post(
    request,
    {
      log: 'flashcard change',
      before: () => (isUuid(id) ? undefined : fail(404, 'not_found')),
      parse: parseCardChange,
    },
    async ({ session, db, input: change }) => {
      const { userId } = session
      if ('delete' in change) {
        return (await deleteCard(db, userId, id)) ? noStoreJson(200, { deleted: true }) : fail(404, 'not_found')
      }
      const notPro = requirePro(session, 'flashcards')
      if (notPro) return notPro
      const row = await reviewCard(db, userId, id, change.review, new Date())
      if (!row) return fail(404, 'not_found')
      const book = await openBook(db, userId, slugOf(row.book)).then((b) => (b?.format === 'text' ? b : null))
      return noStoreJson(200, { card: toCardView(row, (await book?.pages()) ?? null) })
    },
  )

const PAGE = '/account/flashcards'

export const handleFlashcardsForm = (request: Request) =>
  signedInForm(request, { log: 'flashcards form', next: PAGE }, async ({ session, db, form }) => {
    const slug = form.get('book')
    if (form.get('intent') !== 'delete-book' || !isBookSlug(slug)) return seeOther(`${PAGE}?error=invalid`)
    const deleted = await deleteBookCards(db, session.userId, refFor(slug))
    return seeOther(deleted ? `${PAGE}?status=deleted-book` : `${PAGE}?error=missing`)
  })
