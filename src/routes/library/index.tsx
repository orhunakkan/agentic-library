import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { Headphones, Search, X } from 'lucide-react'
import { type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { BookCard } from '~/client/components/BookCard'
import { primaryButton, secondaryButton } from '~/client/features/home/buttons'
import { ContinueReading } from '~/client/features/library/ContinueReading'
import { emptyLibrary, libraryHeading, SIGNED_OUT_EMPTY } from '~/client/features/library/empty-state'
import { countBooks, filterShelves, resolveFilter } from '~/client/features/library/filter'
import { QUERY_MAX, queryOf, textForQuery } from '~/client/features/library/search-text'
import { LibraryStatsCard } from '~/client/features/reading-stats/LibraryStatsCard'
import { RemovedBooks } from '~/client/features/removed-books/RemovedBooks'
import { ShelfActions } from '~/client/features/shelves/ShelfActions'
import type { ShelfItem } from '~/client/features/shelves/shelf-store'
import { type ShelvesApi, useShelves } from '~/client/features/shelves/use-shelves'
import { cn } from '~/client/lib/cn'
import { HUE_CLASSES } from '~/client/lib/hue-classes'
import { getMyArticles, getMyShelf, getShelves } from '~/server/account-functions'
import { getLibrary } from '~/server/functions'
import type { Shelf } from '~/shared/content/library'
import { ARTICLES_HREF } from '~/shared/content/private-book'
import { SITE_NAME } from '~/shared/lib/site'
import type { ShelfView } from '~/shared/shelves/contract'
import { shelfFilter, shelfIdOf } from '~/shared/shelves/shelves'

interface LibrarySearch {
  q?: string
  filter?: string
}

function validateSearch(search: Record<string, unknown>): LibrarySearch {
  return {
    q: typeof search.q === 'string' ? queryOf(search.q) : undefined,
    filter: typeof search.filter === 'string' && search.filter !== 'all' ? search.filter : undefined,
  }
}

export const Route = createFileRoute('/library/')({
  validateSearch,
  loader: async ({ context }) => {
    const [library, myShelf, myArticles, shelves] = await Promise.all([
      getLibrary(),
      context.viewer ? getMyShelf() : null,
      context.viewer ? getMyArticles() : null,
      context.viewer ? getShelves() : null,
    ])
    const readerShelves: ShelfView[] = shelves?.state === 'ready' ? shelves.shelves : []
    return { ...library, myShelf, myArticles, readerShelves }
  },
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ loaderData }) => ({
    meta: [
      { title: `Library | ${SITE_NAME}` },
      { name: 'description', content: libraryHeading(loaderData ?? { stats: { books: 0 }, removed: [] }).description },
      { property: 'og:title', content: `Library | ${SITE_NAME}` },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: '/og/library.png' },
    ],
    links: [{ rel: 'canonical', href: '/library' }],
  }),
  component: LibraryPage,
})

function LibraryPage() {
  const library = Route.useLoaderData()
  const signedIn = Route.useRouteContext().viewer !== null
  const { q: urlQuery, filter: asked = 'all' } = Route.useSearch()
  const navigate = useNavigate({ from: '/library/' })
  const router = useRouter()
  const [text, setText] = useState(urlQuery ?? '')
  const deferredQuery = useDeferredValue(text)
  const readerShelves = useShelves({ initial: library.readerShelves })
  const filter = resolveFilter(asked, readerShelves.shelves)

  const allShelves = useMemo(
    () => [
      ...(library.myShelf ? [library.myShelf] : []),
      ...(library.myArticles ? [library.myArticles] : []),
      ...library.shelves,
    ],
    [library.myShelf, library.myArticles, library.shelves],
  )
  const shelves = useMemo(
    () => filterShelves(allShelves, deferredQuery, filter, readerShelves.shelves),
    [allShelves, deferredQuery, filter, readerShelves.shelves],
  )
  const pressedShelf = readerShelves.shelves.find((s) => s.id === shelfIdOf(filter))
  const shown = countBooks(shelves)
  const covers = useMemo(
    () => new Map(allShelves.flatMap((s) => s.books.map((b) => [b.slug, b] as const))),
    [allShelves],
  )
  const collectionTitles = useMemo(
    () => new Map(library.collections.map((c) => [c.slug, c.title])),
    [library.collections],
  )

  const setSearch = (next: LibrarySearch) =>
    navigate({ search: (prev) => ({ ...prev, ...next }), replace: true, resetScroll: false })
  const typed = (next: string) => {
    setText(next)
    setSearch({ q: queryOf(next) })
  }
  useEffect(() => {
    const latest = validateSearch(router.latestLocation.search).q
    setText((current) => textForQuery(current, urlQuery, latest))
  }, [urlQuery, router])

  const hasAudio = library.stats.audiobooks > 0
  const browsing = !text && filter === 'all'
  const chips = [
    { value: 'all', label: 'All' },
    ...library.collections.map((c) => ({ value: c.slug, label: c.title })),
    ...(library.myArticles ? [{ value: library.myArticles.slug, label: library.myArticles.title }] : []),
    ...(hasAudio ? [{ value: 'audio', label: 'Has audiobook' }] : []),
  ]
  const shelfChips = readerShelves.shelves.map((s) => ({ value: shelfFilter(s.id), label: s.name }))
  const stats = [
    { label: 'Books', value: library.stats.books },
    { label: 'Series', value: library.stats.series },
    ...(hasAudio ? [{ label: 'Audiobooks', value: library.stats.audiobooks }] : []),
  ]

  return (
    <main id="main" className="page-wrap pt-7 md:pt-8" style={{ paddingBottom: 'var(--player-h)' }}>
      <SearchBox query={text} onChange={typed} />

      <div className="mt-9 flex flex-wrap items-end gap-x-6 gap-y-4">
        <h1
          data-testid="library-title"
          className="font-display text-[clamp(44px,5vw,60px)] leading-none font-bold tracking-[-0.03em] text-ink"
        >
          Library
        </h1>
        {libraryHeading(library).showsStats && (
          <aside aria-label="Library stats">
            <dl className="flex flex-wrap gap-2">
              {stats.map(({ label, value }) => (
                <div
                  key={label}
                  data-testid="library-stat"
                  data-key={label.toLowerCase()}
                  className="flex items-baseline gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5"
                >
                  <dt className="text-[13px] text-subtle">{label}</dt>
                  <dd className="text-[15px] font-semibold text-ink tabular">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        )}
      </div>
      <p className="mt-3 max-w-[56ch] text-[17px] leading-relaxed text-body">
        Books to read and listen to, free and in your browser. Search the shelves, or add your own.
      </p>

      <FilterChips
        chips={chips}
        shelfChips={shelfChips}
        filter={filter}
        shown={shown}
        onSelect={(next) => setSearch({ filter: next })}
      />

      {browsing && (
        <div className="mt-8 flex flex-wrap gap-4 empty:hidden">
          <ContinueReading covers={covers} />
          {hasAudio && <ListenCard count={library.stats.audiobooks} />}
          {signedIn && <LibraryStatsCard />}
        </div>
      )}

      {shelves.length === 0 ? (
        <NoRows
          browsing={browsing}
          removedAny={library.removed.length > 0}
          signedIn={signedIn}
          query={deferredQuery}
          onClear={() => {
            setText('')
            setSearch({ q: undefined, filter: undefined })
          }}
        />
      ) : (
        shelves.map((shelf) => {
          if (pressedShelf && shelf.slug === shelfFilter(pressedShelf.id)) {
            return (
              <ReaderShelfRow
                key={shelf.slug}
                shelf={shelf}
                readerShelf={pressedShelf}
                api={readerShelves}
                searching={deferredQuery.trim() !== ''}
                onDeleted={() => {
                  setSearch({ filter: undefined })
                  requestAnimationFrame(() => document.getElementById(ALL_CHIP_ID)?.focus())
                }}
              />
            )
          }
          const mine = shelf.slug === library.myShelf?.slug
          const articles = shelf.slug === library.myArticles?.slug
          return (
            <ShelfRow
              key={shelf.slug}
              shelf={shelf}
              collection={mine || articles ? 'Private' : collectionTitles.get(shelf.collectionSlug)}
              href={mine ? '/account/books' : articles ? ARTICLES_HREF : `/library/${shelf.slug}`}
            />
          )
        })
      )}

      {browsing && <RemovedBooks books={library.removed} />}
    </main>
  )
}

function NoRows({
  browsing,
  removedAny,
  signedIn,
  query,
  onClear,
}: {
  browsing: boolean
  removedAny: boolean
  signedIn: boolean
  query: string
  onClear: () => void
}) {
  switch (emptyLibrary({ browsing, removedAny, signedIn })) {
    case 'no-results':
      return <NoResults query={query} onClear={onClear} />
    case 'removed':
      return <EverythingRemoved />
    case 'empty':
      return <EmptyLibrary />
    case 'signed-out':
      return <SignedOutEmpty />
  }
}

function EmptyCard({ testId, title, children }: { testId: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-10 rounded-[22px] bg-surface p-10 text-center">
      <p className="font-display text-[22px] font-bold text-ink" data-testid={testId}>
        {title}
      </p>
      {children}
    </div>
  )
}

function SignedOutEmpty() {
  const { title, body, createAccount, signIn } = SIGNED_OUT_EMPTY
  return (
    <EmptyCard testId="library-signed-out-empty" title={title}>
      <p className="mx-auto mt-2 max-w-[48ch] text-[15px] text-muted">{body}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to={createAccount.href} className={primaryButton()} data-testid="library-create-account">
          {createAccount.label}
        </Link>
        <Link
          to={signIn.href}
          search={{ next: signIn.next }}
          className={secondaryButton()}
          data-testid="library-sign-in"
        >
          {signIn.label}
        </Link>
      </div>
    </EmptyCard>
  )
}

function EverythingRemoved() {
  return (
    <EmptyCard testId="library-everything-removed" title="You removed every book from your library.">
      <p className="mt-2 text-[15px] text-muted">Restore one below to put it back.</p>
    </EmptyCard>
  )
}

function EmptyLibrary() {
  return (
    <EmptyCard testId="library-empty" title="Your library is empty.">
      <p className="mt-2 text-[15px] text-muted">
        <AppLink
          href="/account/books"
          data-testid="library-import-book"
          className="font-semibold text-ink underline decoration-line underline-offset-4 transition hover:decoration-accent"
        >
          Import a book
        </AppLink>{' '}
        to start reading.
      </p>
    </EmptyCard>
  )
}

function SearchBox({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="relative max-w-[640px]">
      <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-subtle" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        data-testid="library-search"
        value={query}
        maxLength={QUERY_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Book title or series"
        aria-label="Search books"
        className="h-12 w-full rounded-[14px] border border-line bg-surface pr-24 pl-[46px] text-[15px] text-ink outline-none transition placeholder:text-subtle focus:border-accent focus:ring-4 focus:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          data-testid="library-search-clear"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute top-1/2 right-1.5 flex h-9 -translate-y-1/2 items-center gap-1 rounded-[10px] px-3 text-[13px] font-medium text-subtle transition hover:bg-panel hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
          Clear
        </button>
      )}
    </div>
  )
}

const ALL_CHIP_ID = 'library-filter-all'

type Chip = { value: string; label: string }

function FilterChips({
  chips,
  shelfChips,
  filter,
  shown,
  onSelect,
}: {
  chips: Chip[]
  shelfChips: Chip[]
  filter: string
  shown: number
  onSelect: (filter: string | undefined) => void
}) {
  const chip = (filterChip: Chip) => {
    const active = filter === filterChip.value
    return (
      <button
        key={filterChip.value}
        id={filterChip.value === 'all' ? ALL_CHIP_ID : undefined}
        data-testid="library-filter"
        data-key={filterChip.value}
        type="button"
        aria-pressed={active}
        onClick={() => onSelect(filterChip.value === 'all' ? undefined : filterChip.value)}
        className={cn(
          'inline-flex h-11 max-w-full items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold transition',
          active
            ? 'border-accent-fill bg-accent-fill text-on-accent'
            : 'border-line bg-surface text-body hover:border-accent-line hover:text-ink',
        )}
      >
        {filterChip.value === 'audio' && <Headphones className="size-3.5" aria-hidden />}
        <span className="truncate">{filterChip.label}</span>
      </button>
    )
  }
  return (
    <fieldset aria-label="Filter books" className="mt-5 flex min-w-0 flex-wrap items-center gap-2">
      {chips.map(chip)}
      <p
        className="w-full pt-1 text-[14px] text-subtle sm:ml-auto sm:w-auto sm:pt-0"
        aria-live="polite"
        data-testid="library-count"
      >
        Showing {shown} {shown === 1 ? 'book' : 'books'}
      </p>
      {shelfChips.length > 0 && (
        <>
          <span aria-hidden className="basis-full" />
          <span className="mr-1 text-[14px] text-subtle">Your shelves</span>
          {shelfChips.map(chip)}
        </>
      )}
    </fieldset>
  )
}

function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyCard testId="library-no-results" title={<>No results for “{query.trim()}”. Try another word.</>}>
      <button
        type="button"
        onClick={onClear}
        data-testid="library-clear-filters"
        className="mt-5 inline-flex h-11 items-center rounded-xl bg-accent-fill px-5 text-[15px] font-semibold text-on-accent transition hover:brightness-105"
      >
        Clear filters
      </button>
    </EmptyCard>
  )
}

function ListenCard({ count }: { count: number }) {
  return (
    <section
      aria-labelledby="listen-card-title"
      className="flex min-w-0 flex-[1_1_280px] flex-col justify-between gap-4 rounded-[22px] border border-line bg-surface p-6"
    >
      <div>
        <h2 id="listen-card-title" className="eyebrow text-hue-cyan-ink">
          Listen
        </h2>
        <p
          className="mt-2 font-display text-[22px] font-bold tracking-[-0.02em] text-ink"
          data-testid="library-audiobook-count"
        >
          {count} {count === 1 ? 'audiobook' : 'audiobooks'}
        </p>
      </div>
      <AppLink
        href="/library?filter=audio"
        data-testid="library-browse-audiobooks"
        className="inline-flex h-11 w-fit items-center gap-2 rounded-xl bg-hue-cyan px-5 text-[15px] font-semibold text-on-hue transition hover:-translate-y-0.5"
      >
        <Headphones className="size-4" aria-hidden />
        Browse audiobooks
      </AppLink>
    </section>
  )
}

function ReaderShelfRow({
  shelf,
  readerShelf,
  api,
  searching,
  onDeleted,
}: {
  shelf: Shelf
  readerShelf: ShelfItem
  api: ShelvesApi
  searching: boolean
  onDeleted: () => void
}) {
  return (
    <ShelfActions shelf={readerShelf} titleId={`${shelf.slug}-title`} api={api} onDeleted={onDeleted}>
      {({ heading, actions, notice }) => (
        <ShelfRow
          shelf={shelf}
          collection="Your shelf"
          heading={heading}
          actions={actions}
          count={`${shelf.books.length} ${shelf.books.length === 1 ? 'book' : 'books'}`}
        >
          {notice}
          {readerShelf.books.length === 0 && !searching && (
            <p className="mt-3 text-[15px] text-muted" data-testid="shelf-empty">
              No books on “{readerShelf.name}” yet. Open a book and choose Add to shelf.
            </p>
          )}
        </ShelfRow>
      )}
    </ShelfActions>
  )
}

function ShelfRow({
  shelf,
  collection,
  href,
  heading,
  actions,
  count,
  children,
}: {
  shelf: Shelf
  collection?: string
  href?: string
  heading?: ReactNode
  actions?: ReactNode
  count?: string
  children?: ReactNode
}) {
  return (
    <section
      id={shelf.slug}
      data-testid="library-shelf"
      data-key={shelf.slug}
      aria-labelledby={`${shelf.slug}-title`}
      className="mt-11 scroll-mt-[calc(var(--site-nav-h)+24px)]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className={cn('size-3 shrink-0 rounded-full', HUE_CLASSES[shelf.hue].dot)} />
        {heading ?? (
          <h2
            id={`${shelf.slug}-title`}
            className="font-display text-[26px] leading-tight font-bold tracking-[-0.02em] text-ink"
          >
            <AppLink
              href={href ?? `/library/${shelf.slug}`}
              data-testid="library-shelf-link"
              data-key={shelf.slug}
              className="transition hover:text-accent"
            >
              {shelf.title}
            </AppLink>
          </h2>
        )}
        {collection && <span className="text-[14px] text-subtle">{collection}</span>}
        <span
          data-testid="library-shelf-count"
          data-key={shelf.slug}
          className="rounded-full bg-panel px-2.5 py-1 text-[12px] font-semibold text-body"
        >
          {count ?? `${shelf.books.length} vol.`}
        </span>
        {shelf.hasAudio && (
          <span className="rounded-full bg-hue-cyan px-2.5 py-1 text-[12px] font-semibold text-on-hue">Audio</span>
        )}
        {actions}
      </div>
      {children}
      {shelf.description && (
        <p className="mt-2 line-clamp-2 max-w-[72ch] text-[14.5px] leading-relaxed text-muted">{shelf.description}</p>
      )}
      <ul className="mt-4 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
        {shelf.books.map((book) => (
          <li key={book.slug}>
            <BookCard book={book} />
          </li>
        ))}
      </ul>
    </section>
  )
}
