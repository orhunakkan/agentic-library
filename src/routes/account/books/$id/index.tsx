import { createFileRoute, redirect } from '@tanstack/react-router'
import { PrivateAudiobookPage } from '~/client/features/book-details/PrivateAudiobookPage'
import { type PageNotice, PrivateBookPage } from '~/client/features/book-details/PrivateBookPage'
import { getPrivateBookPage } from '~/server/account-functions'
import { handleBookForm } from '~/server/book-details/actions'
import { SITE_NAME } from '~/shared/lib/site'

const STATUSES = ['imported', 'saved', 'cover-removed'] as const
const ERRORS = ['invalid', 'invalid-isbn', 'too-long', 'missing', 'unavailable'] as const
const COVER_PROBLEMS = ['type', 'small', 'large', 'unavailable'] as const

interface BookSearch {
  status?: (typeof STATUSES)[number]
  error?: (typeof ERRORS)[number]
  cover?: (typeof COVER_PROBLEMS)[number]
}

const STATUS_TEXT: Record<NonNullable<BookSearch['status']>, string> = {
  imported: 'Book imported. It’s on your shelf.',
  saved: 'Details saved.',
  'cover-removed': 'The generated cover is back.',
}

const ERROR_TEXT: Record<NonNullable<BookSearch['error']>, string> = {
  invalid: 'Those details couldn’t be saved. Check the title and author, then try again.',
  'invalid-isbn': 'That ISBN isn’t valid. Check it, or leave it empty.',
  'too-long': 'The description is over 4,000 characters. Shorten it, then save again.',
  missing: 'That book wasn’t found. It may have been deleted already.',
  unavailable: 'Something went wrong. Try again in a few minutes.',
}

const COVER_TEXT: Record<NonNullable<BookSearch['cover']>, string> = {
  type: 'the image couldn’t be read',
  small: 'the image is too small',
  large: 'the image is too large',
  unavailable: 'it couldn’t be saved',
}

function noticesFor(search: BookSearch, audio: boolean): PageNotice[] {
  const notices: PageNotice[] = []
  const area = audio ? 'private-audiobook' : 'private-book'
  if (search.status === 'imported' && audio)
    notices.push({ kind: 'success', text: 'Audiobook imported. It’s on your shelf.', testId: `${area}-imported` })
  else if (search.status)
    notices.push({ kind: 'success', text: STATUS_TEXT[search.status], testId: `${area}-${search.status}` })
  if (search.cover)
    notices.push({
      kind: 'error',
      text: `The book was imported without its cover: ${COVER_TEXT[search.cover]}.`,
      testId: `${area}-cover-error`,
    })
  if (search.error) notices.push({ kind: 'error', text: ERROR_TEXT[search.error], testId: `${area}-error` })
  return notices
}

export const Route = createFileRoute('/account/books/$id/')({
  validateSearch: (search: Record<string, unknown>): BookSearch => ({
    status: STATUSES.find((s) => s === search.status),
    error: ERRORS.find((e) => e === search.error),
    cover: COVER_PROBLEMS.find((c) => c === search.cover),
  }),
  beforeLoad: ({ context, params }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: `/account/books/${params.id}` } })
  },
  loader: ({ params }) => getPrivateBookPage({ data: { id: params.id } }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.page.title ?? 'My book'} | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }],
  }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  server: { handlers: { POST: ({ request, params }) => handleBookForm(request, params.id) } },
  component: BookScreen,
})

function BookScreen() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  if (data.format === 'audio')
    return <PrivateAudiobookPage page={data.page} notices={noticesFor(search, true)} rating={data.rating} />
  return <PrivateBookPage page={data.page} notices={noticesFor(search, false)} rating={data.rating} />
}
