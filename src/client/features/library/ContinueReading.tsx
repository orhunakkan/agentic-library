import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { BookCover } from '~/client/components/BookCover'
import { inLibrary, type RecentReading, readRecent } from '~/client/features/reader/continue-reading'
import { onSynced } from '~/client/features/sync/engine'
import type { ShelfBook } from '~/shared/content/library'

export function ContinueReading({ covers }: { covers: ReadonlyMap<string, ShelfBook> }) {
  const [recent, setRecent] = useState<RecentReading[]>([])
  useEffect(() => {
    const read = () => setRecent(inLibrary(readRecent(), new Set(covers.keys())).slice(0, 3))
    read()
    return onSynced((kinds) => {
      if (kinds.includes('reading')) read()
    })
  }, [covers])
  const [first, ...rest] = recent
  if (!first) return null
  const firstBook = covers.get(first.bookSlug)

  return (
    <section aria-label="Continue reading" className="flex min-w-0 flex-[2_1_420px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-5 rounded-[22px] bg-hue-violet p-6 text-on-hue">
        {firstBook && (
          <BookCover
            title={firstBook.title}
            author={firstBook.author}
            cover={firstBook.cover}
            image={firstBook.image}
            className="w-[88px] shrink-0 rounded-lg shadow-[0_12px_28px_-14px_rgb(0_0_0/0.6)]"
          />
        )}
        <div className="min-w-0 flex-[1_1_220px]">
          <h2 className="eyebrow">Continue reading</h2>
          <p className="mt-2 font-display text-[28px] leading-[1.1] font-bold tracking-[-0.02em] text-balance">
            {first.bookTitle}
          </p>
          <p className="mt-1.5 truncate text-[15px]">{first.chapterTitle}</p>
        </div>
        <AppLink
          href={first.href}
          preload={false}
          data-testid="continue-reading-resume"
          data-key={first.bookSlug}
          className="inline-flex h-12 shrink-0 items-center rounded-xl bg-[#1A1033] px-6 text-[15px] font-semibold text-white transition hover:-translate-y-0.5"
        >
          Resume<span className="sr-only"> {first.bookTitle}</span>
        </AppLink>
      </div>
      {rest.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rest.map((entry) => {
            const book = covers.get(entry.bookSlug)
            return (
              <li key={entry.bookSlug}>
                <AppLink
                  href={entry.href}
                  preload={false}
                  data-testid="continue-reading-recent"
                  data-key={entry.bookSlug}
                  className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 transition hover:-translate-y-0.5 hover:border-accent-line"
                >
                  {book && (
                    <BookCover
                      title={book.title}
                      author={book.author}
                      cover={book.cover}
                      image={book.image}
                      className="w-10 shrink-0 rounded-md"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">{entry.bookTitle}</span>
                    <span className="block truncate text-[13px] text-subtle">{entry.chapterTitle}</span>
                  </span>
                  <ArrowRight
                    className="size-4 shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-accent"
                    aria-hidden
                  />
                </AppLink>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
