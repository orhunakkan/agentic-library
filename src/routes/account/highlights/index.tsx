import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Download, Highlighter } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { AccountPage, Button, DateTime, Notice, Section } from '~/client/features/account/ui'
import { SWATCH } from '~/client/features/highlights/HighlightPopover'
import { ProNotice } from '~/client/features/plans/ProNotice'
import { cn } from '~/client/lib/cn'
import { getHighlightsPage } from '~/server/account-functions'
import { handleHighlightsForm } from '~/server/highlights/actions'
import { COLOR_NAMES } from '~/shared/highlights/colors'
import { groupByChapter, type HighlightView } from '~/shared/highlights/group'
import { SITE_NAME } from '~/shared/lib/site'

interface HighlightsSearch {
  book?: string
  status?: 'deleted' | 'deleted-book'
  error?: 'missing' | 'invalid' | 'unavailable'
}

const ERRORS = ['missing', 'invalid', 'unavailable'] as const
const STATUSES = ['deleted', 'deleted-book'] as const

type HighlightsData = Awaited<ReturnType<typeof getHighlightsPage>>
type BookData = Pick<Extract<HighlightsData, { kind: 'book' }>, 'book' | 'highlights'>
type AllData = Extract<HighlightsData, { kind: 'all' }>

const ERROR_TEXT: Record<NonNullable<HighlightsSearch['error']>, string> = {
  missing: 'That highlight wasn’t found. It may have been deleted already.',
  invalid: 'That request wasn’t understood. Try again.',
  unavailable: 'Something went wrong. Try again in a few minutes.',
}

export const Route = createFileRoute('/account/highlights/')({
  validateSearch: (search: Record<string, unknown>): HighlightsSearch => ({
    book: typeof search.book === 'string' && search.book ? search.book : undefined,
    status: STATUSES.find((s) => s === search.status),
    error: ERRORS.find((e) => e === search.error),
  }),
  beforeLoad: ({ context, search }) => {
    const next = search.book ? `/account/highlights?book=${search.book}` : '/account/highlights'
    if (!context.viewer) throw redirect({ to: '/login', search: { next } })
  },
  loaderDeps: ({ search }) => ({ book: search.book }),
  loader: ({ deps }) => getHighlightsPage({ data: { book: deps.book } }),
  head: () => ({ meta: [{ title: `Highlights | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  server: { handlers: { POST: ({ request }) => handleHighlightsForm(request) } },
  component: HighlightsScreen,
})

function HighlightsScreen() {
  const data = Route.useLoaderData()
  const { status, error } = Route.useSearch()
  const canExport = Route.useRouteContext().viewer?.plan === 'pro'
  const notices = (
    <>
      {status === 'deleted' && (
        <Notice kind="success" data-testid="my-highlights-deleted">
          Highlight deleted.
        </Notice>
      )}
      {status === 'deleted-book' && (
        <Notice kind="success" data-testid="my-highlights-deleted-book">
          Deleted every highlight in this book.
        </Notice>
      )}
      {error && (
        <Notice kind="error" data-testid="my-highlights-error">
          {ERROR_TEXT[error]}
        </Notice>
      )}
    </>
  )

  return data.kind === 'book' ? (
    <BookHighlights book={data.book} highlights={data.highlights} notices={notices} canExport={canExport} />
  ) : (
    <HighlightedBooks books={data.books} notices={notices} canExport={canExport} />
  )
}

const ExportPro = () => (
  <ProNotice feature="export" className="mt-5 space-y-1 text-[14.5px] leading-relaxed text-body" />
)

function BookHighlights({
  book,
  highlights,
  notices,
  canExport,
}: BookData & { notices: ReactNode; canExport: boolean }) {
  const { chapters, missing } = groupByChapter(highlights)
  return (
    <AccountPage
      eyebrow="Highlights"
      title={book.title}
      titleTestId="highlights-book-title"
      lead={book.author || undefined}
    >
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14.5px]">
        <Link
          to="/account/highlights"
          className="font-medium text-accent underline-offset-2 hover:underline"
          data-testid="my-highlights-all-books"
        >
          All books
        </Link>
        {!book.removed && canExport && (
          <a
            href={`/account/highlights/export/${book.slug}`}
            download
            data-testid="my-highlights-export-book"
            className="inline-flex items-center gap-1.5 font-medium text-accent underline-offset-2 hover:underline"
          >
            <Download className="size-4" aria-hidden />
            Export as Markdown
          </a>
        )}
      </div>
      {!book.removed && !canExport && <ExportPro />}
      {notices}
      {highlights.length === 0 && (
        <p className="mt-8 text-[14.5px] text-muted" data-testid="my-highlights-empty">
          No highlights in this book.
        </p>
      )}
      {chapters.map((chapter) => (
        <Section
          key={chapter.chapterIndex}
          id={`chapter-${chapter.chapterIndex + 1}`}
          title={`${chapter.chapterIndex + 1}. ${chapter.chapterTitle}`}
        >
          <HighlightList highlights={chapter.highlights} linked={!book.removed} />
        </Section>
      ))}
      {missing.length > 0 && (
        <Section id="missing" title="Passages no longer found">
          <HighlightList highlights={missing} linked={false} />
        </Section>
      )}
      {highlights.length > 0 && (
        <details className="mt-10 rounded-[22px] border border-line bg-surface p-5 md:p-6">
          <summary
            className="cursor-pointer text-[14.5px] font-semibold text-ink"
            data-testid="my-highlights-delete-all-open"
          >
            Delete all highlights in this book
          </summary>
          <p className="mt-3 text-[14.5px] text-muted" data-testid="my-highlights-delete-all-count">
            This deletes {highlights.length === 1 ? 'the highlight' : `all ${highlights.length} highlights`} and their
            notes. It can’t be undone.
          </p>
          <form method="post" action="/account/highlights" className="mt-4">
            <input type="hidden" name="intent" value="delete-book" />
            <input type="hidden" name="book" value={book.slug} />
            <Button variant="danger" data-testid="my-highlights-delete-all">
              Delete all highlights
            </Button>
          </form>
        </details>
      )}
    </AccountPage>
  )
}

function HighlightedBooks({
  books,
  notices,
  canExport,
}: {
  books: AllData['books']
  notices: ReactNode
  canExport: boolean
}) {
  return (
    <AccountPage
      eyebrow="Account"
      title="Highlights"
      titleTestId="highlights-title"
      lead="Everything you’ve highlighted, by book. Your highlights and notes are private to your account."
      nav
    >
      {books.length > 0 && !canExport && <ExportPro />}
      {books.length > 0 && canExport && (
        <div className="mt-5 text-[14.5px]">
          <a
            href="/account/highlights/export"
            download
            data-testid="my-highlights-export-all"
            className="inline-flex items-center gap-1.5 font-medium text-accent underline-offset-2 hover:underline"
          >
            <Download className="size-4" aria-hidden />
            Export all as Markdown
          </a>
        </div>
      )}
      {notices}
      <Section id="books" title="Your books">
        {books.length === 0 ? (
          <p className="text-[14.5px] text-muted" data-testid="my-highlights-empty">
            No highlights yet. Select text while reading to highlight it.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {books.map((book) => (
              <li
                key={book.slug}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                data-testid="my-highlights-book"
                data-key={book.slug}
              >
                <Highlighter className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden />
                <div className="min-w-0 flex-1 text-[14.5px]">
                  {book.removed ? (
                    <p className="font-medium text-ink">{book.title}</p>
                  ) : (
                    <Link
                      to="/account/highlights"
                      search={{ book: book.slug }}
                      className="font-medium text-ink transition hover:text-accent"
                      data-testid="my-highlights-book-link"
                      data-key={book.slug}
                    >
                      {book.title}
                    </Link>
                  )}
                  <p className="text-muted" data-testid="my-highlights-book-counts" data-key={book.slug}>
                    {book.author && `${book.author} · `}
                    {count(book.highlights, 'highlight', 'highlights')} · {count(book.notes, 'note', 'notes')} · changed{' '}
                    <DateTime iso={book.updatedAt} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </AccountPage>
  )
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

function HighlightList({ highlights, linked }: { highlights: HighlightView[]; linked: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {highlights.map((h) => (
        <li
          key={h.id}
          className="flex gap-3 py-4 first:pt-0 last:pb-0"
          data-testid="my-highlights-item"
          data-key={h.id}
        >
          <span aria-hidden className={cn('w-1 shrink-0 rounded-full', SWATCH[h.color])} />
          <div className="min-w-0 flex-1 text-[14.5px]">
            <span className="sr-only">{COLOR_NAMES[h.color]} highlight: </span>
            <blockquote className="font-serif leading-relaxed whitespace-pre-line text-ink [overflow-wrap:anywhere]">
              {h.text}
            </blockquote>
            {h.note && (
              <p className="mt-2 leading-relaxed whitespace-pre-line text-muted [overflow-wrap:anywhere]">
                <span className="sr-only">Note: </span>
                {h.note}
              </p>
            )}
            {h.status === 'missing' && (
              <p className="mt-2 text-[13.5px] text-muted" data-testid="my-highlights-missing" data-key={h.id}>
                This passage changed or moved, so it can’t be shown on the page.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {linked && h.place && (
                <AppLink
                  href={h.place.href}
                  preload={false}
                  data-testid="my-highlights-place"
                  data-key={h.id}
                  className="inline-flex min-h-9 items-center rounded-full bg-accent/12 px-3 text-[13px] font-medium text-accent transition hover:bg-accent/20"
                >
                  {h.place.label}
                </AppLink>
              )}
              <form method="post" action="/account/highlights">
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="id" value={h.id} />
                <button
                  type="submit"
                  data-testid="my-highlights-delete"
                  data-key={h.id}
                  className="inline-flex min-h-9 items-center rounded-full px-3 text-[13px] text-red-700 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  Delete<span className="sr-only"> this highlight</span>
                </button>
              </form>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
