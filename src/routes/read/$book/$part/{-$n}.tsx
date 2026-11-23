import { createFileRoute, ErrorComponent, type ErrorComponentProps } from '@tanstack/react-router'
import { useEffect } from 'react'
import { NotFound } from '~/client/components/NotFound'
import { refreshCopy } from '~/client/features/offline/download'
import { isNetworkFailure } from '~/client/features/offline/network'
import { isOfflineMissing, readerPageFromCopy } from '~/client/features/offline/offline-reader'
import { forgetGoneCopy } from '~/client/features/offline/reconcile'
import { readCopy } from '~/client/features/offline/store'
import { Reader } from '~/client/features/reader/Reader'
import { getReaderPage } from '~/server/functions'
import { privateBookId } from '~/shared/content/private-book'

const compared = new Set<string>()

async function refreshIfOld(slug: string, version: string) {
  if (compared.has(slug) || !version) return
  compared.add(slug)
  const copy = await readCopy(slug).catch(() => null)
  if (copy && copy.version !== version) await refreshCopy(slug)
}

export const Route = createFileRoute('/read/$book/$part/{-$n}')({
  loader: async ({ params }) => {
    try {
      return {
        ...(await getReaderPage({ data: { book: params.book, part: params.part, n: params.n } })),
        offline: false,
      }
    } catch (error) {
      if (typeof window === 'undefined' || !isNetworkFailure(error)) throw error
      return readerPageFromCopy(params.book, params.part, params.n)
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { view } = loaderData
    if (privateBookId(view.book.slug))
      return { meta: [{ title: view.documentTitle }, { name: 'robots', content: 'noindex' }] }
    return {
      meta: [
        { title: view.documentTitle },
        { name: 'description', content: `${view.book.title} by ${view.book.author}: ${view.chapterTitle}` },
        { property: 'og:title', content: `${view.book.title} · ${view.chapterTitle}` },
        { property: 'og:type', content: 'book' },
        { property: 'og:image', content: `/og/book/${view.book.slug}.png` },
      ],
      links: [{ rel: 'canonical', href: view.canonicalPath }],
    }
  },
  component: ReaderRoute,
  errorComponent: ReaderError,
  notFoundComponent: ReaderNotFound,
})

function ReaderRoute() {
  const { view, offline, offlineVersion } = Route.useLoaderData()
  const { viewer } = Route.useRouteContext()
  useEffect(() => {
    if (!offline) void refreshIfOld(view.book.slug, offlineVersion)
  }, [view.book.slug, offline, offlineVersion])
  return <Reader view={view} signedIn={viewer !== null && !offline} offline={offline} />
}

function ReaderNotFound() {
  const { book } = Route.useParams()
  useEffect(() => {
    void forgetGoneCopy(book)
  }, [book])
  return <NotFound />
}

function ReaderError(props: ErrorComponentProps) {
  if (!isOfflineMissing(props.error)) return <ErrorComponent {...props} />
  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center"
      style={{ paddingBottom: 'var(--player-h)' }}
    >
      <h1
        data-testid="reader-offline-title"
        className="font-display text-[clamp(34px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.03em] text-balance text-ink"
      >
        You’re offline
      </h1>
      <p className="mt-3 text-muted">This book isn’t downloaded on this device.</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        <button
          type="button"
          data-testid="reader-offline-retry"
          onClick={() => window.location.reload()}
          className="inline-flex h-12 items-center rounded-xl bg-accent-fill px-6 text-[15px] font-semibold text-on-accent transition hover:brightness-105"
        >
          Try again
        </button>
        <a
          href="/offline.html"
          data-testid="reader-offline-downloads"
          className="text-[15px] font-medium text-ink underline underline-offset-4"
        >
          Downloaded books
        </a>
      </div>
    </main>
  )
}
