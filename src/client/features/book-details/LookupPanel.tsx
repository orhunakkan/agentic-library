import { LoaderCircle, Search, X } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { BookCover } from '~/client/components/BookCover'
import { cn } from '~/client/lib/cn'
import { privateCover } from '~/shared/content/private-book'
import { type Applied, applyMatch, type LookupMatch, lookup } from './details-client'
import { LOOKUP_PROBLEM_TEXT, matchesText } from './lookup-problems'

const field =
  'mt-2 h-12 w-full rounded-xl border border-line bg-page px-4 text-[16px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15'
const button =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[14.5px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60'

export interface LookupBook {
  id: string
  title: string
  author: string
  isbn: string | null
}

export function LookupPanel({
  book,
  onApplied,
  onClose,
}: {
  book: LookupBook
  onApplied: (applied: Applied) => void
  onClose: () => void
}) {
  const id = useId()
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.author)
  const [isbn, setIsbn] = useState(book.isbn ?? '')
  const [useCover, setUseCover] = useState(true)
  const [useDescription, setUseDescription] = useState(true)
  const [searching, setSearching] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [matches, setMatches] = useState<LookupMatch[] | null>(null)
  const [status, setStatus] = useState('')
  const titleField = useRef<HTMLInputElement>(null)

  useEffect(() => titleField.current?.focus(), [])

  async function search(e: FormEvent) {
    e.preventDefault()
    if (searching) return
    if (!title.trim() && !isbn.trim()) {
      setStatus(LOOKUP_PROBLEM_TEXT.invalid)
      return
    }
    setSearching(true)
    setStatus('')
    const found = await lookup({ book: book.id, title, author, isbn })
    setSearching(false)
    if (!found.ok) {
      setStatus(LOOKUP_PROBLEM_TEXT[found.problem])
      return
    }
    setMatches(found.value)
    setStatus(matchesText(found.value.length))
  }

  async function use(match: LookupMatch) {
    if (applying) return
    setApplying(match.work)
    setStatus('')
    const applied = await applyMatch(book.id, {
      work: match.work,
      coverId: match.coverId,
      useCover,
      useDescription,
    })
    setApplying(null)
    if (!applied.ok) {
      setStatus(LOOKUP_PROBLEM_TEXT[applied.problem])
      return
    }
    if (applied.value.coverProblem) setStatus(LOOKUP_PROBLEM_TEXT[applied.value.coverProblem])
    onApplied(applied.value)
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="mt-6 rounded-2xl border border-line bg-page p-4 sm:p-5"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex items-start gap-3">
        <h4 id={`${id}-title`} className="min-w-0 flex-1 pt-2.5 text-[15px] font-semibold text-ink">
          Find cover and details
        </h4>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          data-testid="book-lookup-close"
          className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-panel hover:text-ink"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-muted">
        Folio’s server sends the title and author, or the ISBN, below to Open Library to look for matches. Your browser
        then shows the covers it finds from Open Library. Nothing else about you or your books is sent.
      </p>

      <form onSubmit={search} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end">
        <label className="block text-[14px] font-medium text-ink">
          Title
          <input
            ref={titleField}
            value={title}
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
            className={field}
            data-testid="book-lookup-title"
          />
        </label>
        <label className="block text-[14px] font-medium text-ink">
          Author
          <input
            value={author}
            maxLength={200}
            onChange={(e) => setAuthor(e.target.value)}
            className={field}
            data-testid="book-lookup-author"
          />
        </label>
        <label className="block text-[14px] font-medium text-ink">
          ISBN
          <input
            value={isbn}
            inputMode="numeric"
            maxLength={40}
            onChange={(e) => setIsbn(e.target.value)}
            className={field}
            data-testid="book-lookup-isbn"
          />
        </label>
        <button
          type="submit"
          disabled={searching}
          className={cn(button, 'h-12 bg-accent-fill text-on-accent hover:brightness-105')}
          data-testid="book-lookup-search"
        >
          {searching ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <Search className="size-4" aria-hidden />
          )}
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      <div aria-busy={searching || undefined} className="mt-5">
        <p role="status" className="min-h-[1.5em] text-[14px] text-ink" data-testid="book-lookup-status">
          {status}
        </p>
        {matches && matches.length > 0 && (
          <>
            <fieldset className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              <legend className="sr-only">What to use from a match</legend>
              <label className="inline-flex min-h-11 items-center gap-2 text-[14.5px] text-ink">
                <input
                  type="checkbox"
                  checked={useCover}
                  onChange={(e) => setUseCover(e.target.checked)}
                  className="size-5 accent-accent"
                  data-testid="book-lookup-use-cover"
                />
                Use its cover
              </label>
              <label className="inline-flex min-h-11 items-center gap-2 text-[14.5px] text-ink">
                <input
                  type="checkbox"
                  checked={useDescription}
                  onChange={(e) => setUseDescription(e.target.checked)}
                  className="size-5 accent-accent"
                  data-testid="book-lookup-use-description"
                />
                Use its description
              </label>
            </fieldset>
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {matches.map((match) => (
                <li
                  key={match.work}
                  className="flex flex-wrap items-center gap-3 p-3"
                  data-testid="book-lookup-match"
                  data-key={match.work}
                >
                  {match.thumb ? (
                    <img
                      src={match.thumb}
                      alt=""
                      width={48}
                      height={72}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="aspect-[2/3] w-12 shrink-0 rounded-md bg-surface object-cover"
                    />
                  ) : (
                    <BookCover
                      title={match.title}
                      author={match.author ?? ''}
                      cover={privateCover(match.title)}
                      className="w-12 shrink-0 rounded-md"
                    />
                  )}
                  <div className="min-w-0 flex-[1_1_160px] text-[14.5px]">
                    <p className="font-semibold break-words text-ink">{match.title}</p>
                    <p className="text-muted">{[match.author, match.year].filter(Boolean).join(' · ')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => use(match)}
                    disabled={applying !== null}
                    data-testid="book-lookup-use-match"
                    data-key={match.work}
                    className={cn(
                      button,
                      'border border-line bg-surface text-ink hover:border-accent-line hover:bg-panel',
                    )}
                  >
                    {applying === match.work && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                    {applying === match.work ? 'Applying…' : 'Use this match'}
                    <span className="sr-only"> for {match.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
