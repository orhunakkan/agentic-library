import { useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { BookCover } from '~/client/components/BookCover'
import type { ShelfBook } from '~/shared/content/library'
import { RemovalProblem, useBookRemoval } from './RemoveFromLibrary'
import type { RemovedBookProblem } from './removed-books-client'

export const REMOVED_BOOKS_ID = 'removed-books'

export function RemovedBooks({ books }: { books: readonly ShelfBook[] }) {
  if (books.length === 0) return null
  return (
    <section
      id={REMOVED_BOOKS_ID}
      aria-labelledby="removed-books-title"
      className="mt-14 scroll-mt-[calc(var(--site-nav-h)+24px)] border-t border-line pt-8"
    >
      <h2 id="removed-books-title" className="font-display text-[22px] leading-tight font-bold text-ink">
        Removed from your library
      </h2>
      <p className="mt-2 max-w-[60ch] text-[14.5px] leading-relaxed text-muted">
        You took these out of your library, its series and search. Everyone else still sees them. Restore one to put it
        back.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
        {books.map((book) => (
          <RemovedBook key={book.slug} book={book} />
        ))}
      </ul>
    </section>
  )
}

function RemovedBook({ book }: { book: ShelfBook }) {
  const change = useBookRemoval()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<RemovedBookProblem | null>(null)

  async function restore() {
    setProblem(null)
    setBusy(true)
    const found = await change(book.slug, false)
    if (found) {
      setBusy(false)
      setProblem(found)
    }
  }

  return (
    <li className="flex min-w-0 items-center gap-4 rounded-[18px] border border-line bg-surface p-3">
      <BookCover title={book.title} author={book.author} cover={book.cover} image={book.image} className="w-12" />
      <div className="min-w-0 flex-1">
        <AppLink
          href={book.href}
          data-testid="removed-book-link"
          data-key={book.slug}
          className="block truncate text-[15px] font-semibold text-ink hover:text-accent"
        >
          {book.title}
        </AppLink>
        <p className="truncate text-[13.5px] text-muted">{book.author}</p>
        {problem && (
          <p
            role="alert"
            data-testid="removed-book-error"
            data-key={book.slug}
            className="mt-1 text-[13.5px] text-red-700 dark:text-red-300"
          >
            <RemovalProblem problem={problem} />
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={restore}
        data-testid="removed-book-restore"
        data-key={book.slug}
        disabled={busy}
        aria-label={`Restore ${book.title}`}
        className="inline-flex h-11 shrink-0 items-center rounded-xl border border-line bg-surface px-4 text-[14px] font-semibold text-ink transition hover:bg-panel disabled:opacity-60"
      >
        Restore
      </button>
    </li>
  )
}
