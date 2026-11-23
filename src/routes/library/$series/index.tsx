import { createFileRoute } from '@tanstack/react-router'
import { AppLink } from '~/client/components/AppLink'
import { BackLink } from '~/client/components/BackLink'
import { BookCard } from '~/client/components/BookCard'
import { REMOVED_BOOKS_ID } from '~/client/features/removed-books/RemovedBooks'
import { cn } from '~/client/lib/cn'
import { HUE_CLASSES } from '~/client/lib/hue-classes'
import { getSeriesPage } from '~/server/functions'
import { SITE_NAME } from '~/shared/lib/site'

export const Route = createFileRoute('/library/$series/')({
  loader: ({ params }) => getSeriesPage({ data: { series: params.series } }),
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [], links: [] }
    const { series } = loaderData
    return {
      meta: [
        { title: `${series.title} | ${SITE_NAME}` },
        { name: 'description', content: series.description },
        { property: 'og:title', content: series.title },
        { property: 'og:description', content: series.description },
        { property: 'og:image', content: `/og/series/${series.slug}.png` },
      ],
      links: [{ rel: 'canonical', href: `/library/${series.slug}` }],
    }
  },
  component: SeriesPage,
})

function SeriesPage() {
  const { series, books, collection, hue, removedCount } = Route.useLoaderData()
  const colors = HUE_CLASSES[hue]
  return (
    <main id="main" className="page-wrap pt-7" style={{ paddingBottom: 'var(--player-h)' }}>
      <BackLink href="/library" label="Library" />
      <section aria-labelledby="series-title" className={cn('mt-5 rounded-[24px] border p-7 md:p-10', colors.tint)}>
        <p className={cn('eyebrow', colors.ink)}>Series{collection ? ` · ${collection}` : ''}</p>
        <h1
          id="series-title"
          data-testid="series-title"
          className="mt-3 font-display text-[clamp(34px,4vw,52px)] leading-[1.05] font-bold tracking-[-0.03em] text-balance text-ink"
        >
          {series.title}
        </h1>
        <p className="mt-4 max-w-[60ch] text-[17px] leading-relaxed text-body">{series.description}</p>
        <p
          data-testid="series-count"
          className="mt-6 inline-flex rounded-full bg-surface/70 px-3.5 py-1.5 text-[14px] font-semibold text-ink"
        >
          {books.length} {books.length === 1 ? 'volume' : 'volumes'}
        </p>
      </section>
      {removedCount > 0 && <RemovedNote all={books.length === 0} count={removedCount} />}
      {books.length > 0 && (
        <ul className="mt-10 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
          {books.map((book) => (
            <li key={book.slug}>
              <BookCard book={book} large />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function RemovedNote({ all, count }: { all: boolean; count: number }) {
  const link = (
    <AppLink
      href={`/library#${REMOVED_BOOKS_ID}`}
      data-testid="series-see-removed"
      className="font-semibold text-ink underline decoration-line underline-offset-4 transition hover:decoration-accent"
    >
      See removed books
    </AppLink>
  )
  if (all) {
    return (
      <div className="mt-10 rounded-[22px] bg-surface p-10 text-center" data-testid="series-removed-note">
        <p className="font-display text-[22px] font-bold text-ink">You removed every book in this series.</p>
        <p className="mt-2 text-[15px] text-muted">{link}</p>
      </div>
    )
  }
  return (
    <p className="mt-6 text-[14.5px] text-muted" data-testid="series-removed-note">
      {count === 1 ? '1 book you removed isn’t shown.' : `${count} books you removed aren’t shown.`} {link}
    </p>
  )
}
