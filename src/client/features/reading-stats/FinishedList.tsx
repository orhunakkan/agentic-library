import { useRouter } from '@tanstack/react-router'
import { BookCheck } from 'lucide-react'
import { useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { Notice } from '~/client/features/account/ui'
import type { FinishedBook } from '~/shared/reading-stats/contract'
import { forgetFinished } from './finish'
import { type FinishedProblem, setFinished } from './stats-client'
import { FINISHED_ERRORS, finishedCountLine, finishedDateLine, unfinishedLine } from './stats-copy'

export function FinishedList({ books, thisYear }: { books: FinishedBook[]; thisYear: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [problem, setProblem] = useState<FinishedProblem | null>(null)

  const unfinish = async (book: FinishedBook) => {
    setBusy(book.book)
    setStatus(null)
    setProblem(null)
    const result = await setFinished(book.book, false)
    setBusy(null)
    if (!result.ok) {
      setProblem(result.problem)
      return
    }
    forgetFinished(book.book)
    setStatus(unfinishedLine(book.title))
    await router.invalidate()
  }

  return (
    <>
      <p className="text-[15px] font-medium text-ink" data-testid="stats-finished-count">
        {finishedCountLine(thisYear)}
      </p>
      {books.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {books.map((book) => (
            <li
              key={book.book}
              data-testid="stats-finished-book"
              data-key={book.book}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <BookCheck className="size-5 shrink-0 text-subtle" aria-hidden />
              <div className="min-w-0 flex-[1_1_180px] text-[14.5px]">
                <AppLink
                  href={book.href}
                  data-testid="stats-finished-link"
                  data-key={book.book}
                  className="font-medium text-ink transition [overflow-wrap:anywhere] hover:text-accent"
                >
                  {book.title}
                </AppLink>
                <p className="text-muted">
                  <time dateTime={book.finishedAt} suppressHydrationWarning>
                    {finishedDateLine(book.finishedAt)}
                  </time>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void unfinish(book)}
                disabled={busy !== null}
                data-testid="stats-unfinish"
                data-key={book.book}
                aria-label={`Not finished: ${book.title}`}
                className="inline-flex min-h-10 items-center rounded-full px-3 text-[13.5px] font-medium text-muted transition hover:bg-panel hover:text-ink disabled:opacity-50"
              >
                Not finished
              </button>
            </li>
          ))}
        </ul>
      )}
      {status && (
        <Notice kind="success" data-testid="stats-finished-status">
          {status}
        </Notice>
      )}
      {problem && (
        <Notice kind="error" data-testid="stats-finished-error">
          {FINISHED_ERRORS[problem]}
        </Notice>
      )}
    </>
  )
}
