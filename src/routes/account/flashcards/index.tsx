import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  BookFlashcardsPage,
  FlashcardBooksPage,
  type FlashcardsNotice,
} from '~/client/features/flashcards/FlashcardsPage'
import { getBookFlashcards, getFlashcardBooks } from '~/server/account-functions'
import { handleFlashcardsForm } from '~/server/flashcards/actions'
import { SITE_NAME } from '~/shared/lib/site'

interface FlashcardsSearch {
  book?: string
  status?: FlashcardsNotice
}

const NOTICES: readonly FlashcardsNotice[] = ['deleted-book', 'missing', 'invalid', 'unavailable']

export const Route = createFileRoute('/account/flashcards/')({
  validateSearch: (search: Record<string, unknown>): FlashcardsSearch => ({
    book: typeof search.book === 'string' && search.book ? search.book : undefined,
    status: NOTICES.find((n) => n === search.status || n === search.error),
  }),
  beforeLoad: ({ context, search }) => {
    const next = search.book ? `/account/flashcards?book=${search.book}` : '/account/flashcards'
    if (!context.viewer) throw redirect({ to: '/login', search: { next } })
  },
  loaderDeps: ({ search }) => ({ book: search.book }),
  loader: ({ deps }) => (deps.book ? getBookFlashcards({ data: { book: deps.book } }) : getFlashcardBooks()),
  head: () => ({ meta: [{ title: `Flashcards | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  server: { handlers: { POST: ({ request }) => handleFlashcardsForm(request) } },
  component: FlashcardsScreen,
})

function FlashcardsScreen() {
  const data = Route.useLoaderData()
  const { status } = Route.useSearch()
  return data.kind === 'book' ? (
    <BookFlashcardsPage key={data.book.slug} data={data} />
  ) : (
    <FlashcardBooksPage books={data.books} notice={status} />
  )
}
