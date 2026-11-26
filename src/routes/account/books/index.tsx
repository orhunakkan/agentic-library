import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { BookOpen, Headphones } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { BookCover } from '~/client/components/BookCover'
import { AccountPage, Button, DateTime, Notice, Section } from '~/client/features/account/ui'
import { forgetUnlistedCopies } from '~/client/features/offline/reconcile'
import { getMyBooksPage } from '~/server/account-functions'
import { handleBooksForm } from '~/server/book-actions'
import { formatLength } from '~/shared/audiobooks/chapters'
import { SITE_NAME } from '~/shared/lib/site'

const BookImporter = lazy(() =>
  import('~/client/features/import/BookImporter').then((m) => ({ default: m.BookImporter })),
)

interface BooksSearch {
  status?: 'imported' | 'deleted'
  error?: 'missing' | 'invalid' | 'unavailable'
}

const STATUSES = ['imported', 'deleted'] as const
const ERRORS = ['missing', 'invalid', 'unavailable'] as const

const ERROR_TEXT: Record<NonNullable<BooksSearch['error']>, string> = {
  missing: 'That book wasn’t found. It may have been deleted already.',
  invalid: 'That request wasn’t understood. Try again.',
  unavailable: 'Something went wrong. Try again in a few minutes.',
}

export const Route = createFileRoute('/account/books/')({
  validateSearch: (search: Record<string, unknown>): BooksSearch => ({
    status: STATUSES.find((s) => s === search.status),
    error: ERRORS.find((e) => e === search.error),
  }),
  beforeLoad: ({ context }) => {
    if (!context.viewer) throw redirect({ to: '/login', search: { next: '/account/books' } })
  },
  loader: () => getMyBooksPage(),
  head: () => ({ meta: [{ title: `My books | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  server: { handlers: { POST: ({ request }) => handleBooksForm(request) } },
  component: BooksScreen,
})

function BooksScreen() {
  const { books, articleIds, imageBytesUsed, audiobooks, audioBytesUsed, bookCount } = Route.useLoaderData()
  const { status, error } = Route.useSearch()
  const navigate = useNavigate({ from: '/account/books/' })
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const listed = [...books.map((b) => b.id), ...articleIds].join(' ')
  useEffect(() => {
    void forgetUnlistedCopies(listed ? listed.split(' ') : [])
  }, [listed])

  const imported = (id: string, cover?: 'type' | 'small' | 'unavailable') =>
    navigate({
      to: '/account/books/$id',
      params: { id },
      search: { status: 'imported', ...(cover ? { cover } : {}) },
    })

  return (
    <AccountPage
      eyebrow="Account"
      title="My books"
      titleTestId="my-books-title"
      lead="Import your own EPUB, PDF and Markdown books, and M4B and MP3 audiobooks, and read or listen to them here."
      nav
    >
      {status === 'imported' && (
        <Notice kind="success" data-testid="my-books-imported">
          Book imported. It’s on your shelf.
        </Notice>
      )}
      {status === 'deleted' && (
        <Notice kind="success" data-testid="my-books-deleted">
          Book deleted.
        </Notice>
      )}
      {error && (
        <Notice kind="error" data-testid="my-books-error">
          {ERROR_TEXT[error]}
        </Notice>
      )}

      <Section id="import" title="Import a book">
        <p className="text-[14.5px] leading-relaxed text-muted">
          Import only books you have the right to read. Imported books are private to your account.
        </p>
        {hydrated ? (
          <Suspense
            fallback={
              <p className="mt-4 text-[14.5px] text-muted" data-testid="import-loading">
                Loading the importer…
              </p>
            }
          >
            <div className="mt-2">
              <BookImporter
                imageBytesUsed={imageBytesUsed}
                audiobooks={audiobooks}
                audioBytesUsed={audioBytesUsed}
                bookCount={bookCount}
                onImported={imported}
              />
            </div>
          </Suspense>
        ) : (
          <p className="mt-4 text-[14.5px] font-medium text-ink" data-testid="import-needs-javascript">
            Importing needs JavaScript.
          </p>
        )}
      </Section>

      <Section id="books" title="Your books">
        {books.length === 0 ? (
          <p className="text-[14.5px] text-muted" data-testid="my-books-empty">
            No books yet. Imported books appear here and on your shelf in the Library.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {books.map((book) => (
              <li
                key={book.id}
                className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0"
                data-testid="my-books-row"
                data-key={book.id}
              >
                <BookCover
                  title={book.title}
                  author={book.author}
                  cover={book.cover}
                  image={book.image}
                  className="w-10 shrink-0 rounded-md"
                />
                <div className="min-w-0 flex-[1_1_180px] text-[14.5px]">
                  <AppLink
                    href={book.href}
                    preload={false}
                    data-testid="my-books-open"
                    data-key={book.id}
                    className="font-medium break-words text-ink transition hover:text-accent"
                  >
                    {book.title}
                  </AppLink>
                  <p className="text-muted">
                    {book.author} · {book.chapterCount} {book.chapterCount === 1 ? 'chapter' : 'chapters'} · imported{' '}
                    <DateTime iso={book.importedAt} />
                  </p>
                  {book.audioMs !== null && <p className="text-muted">Audiobook · {formatLength(book.audioMs)}</p>}
                </div>
                <AppLink
                  href={book.readHref}
                  preload={false}
                  data-testid="my-books-read"
                  data-key={book.id}
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-[15px] font-semibold text-ink transition hover:border-accent-line hover:bg-panel"
                >
                  {book.audioMs !== null ? (
                    <>
                      <Headphones className="size-4" aria-hidden />
                      Listen<span className="sr-only"> to {book.title}</span>
                    </>
                  ) : (
                    <>
                      <BookOpen className="size-4" aria-hidden />
                      Read<span className="sr-only"> {book.title}</span>
                    </>
                  )}
                </AppLink>
                <form method="post" action="/account/books">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="id" value={book.id} />
                  <Button variant="danger" data-testid="my-books-delete" data-key={book.id}>
                    Delete<span className="sr-only"> {book.title}</span>
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-5 text-[13.5px] text-muted">
          Deleted books are removed at once. Nightly backups keep a copy for up to 14 days. Audiobook files aren’t in
          the backups, so keep your own copy.
        </p>
      </Section>
    </AccountPage>
  )
}
