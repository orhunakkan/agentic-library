import { useRouter } from '@tanstack/react-router'
import { Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { BackLink } from '~/client/components/BackLink'
import { BookCover } from '~/client/components/BookCover'
import { useToast } from '~/client/components/Toast'
import { Button, Notice } from '~/client/features/account/ui'
import { DELETE_NOTE } from '~/client/features/articles/article-messages'
import {
  ChooseImageButton,
  CoverChooser,
  chooserButton,
  coverSourceText,
  IMAGE_PROBLEM_TEXT,
} from '~/client/features/book-details/CoverChooser'
import { drawCover } from '~/client/features/book-details/cover-image'
import { type Applied, uploadCover } from '~/client/features/book-details/details-client'
import { LookupPanel } from '~/client/features/book-details/LookupPanel'
import { ReadAloudButton } from '~/client/features/library/ReadAloudButton'
import { StartOrContinue } from '~/client/features/library/StartOrContinue'
import { DownloadButton } from '~/client/features/offline/DownloadButton'
import { BookRating } from '~/client/features/ratings/BookRating'
import { AddToShelf } from '~/client/features/shelves/AddToShelf'
import { cn } from '~/client/lib/cn'
import { pad2 } from '~/client/lib/format'
import { HUE_CLASSES } from '~/client/lib/hue-classes'
import { readTimeText } from '~/shared/articles/read-time'
import { PRIVATE_SHELF_HUE } from '~/shared/content/hues'
import {
  ARTICLES_HREF,
  MY_BOOKS_HREF,
  type PrivateBookPage as Page,
  type PrivateBookFact,
} from '~/shared/content/private-book'
import { isBadIsbn } from '~/shared/import/isbn'
import { DESCRIPTION_MAX, PUBLISHER_MAX } from '~/shared/import/limits'
import type { RatingState } from '~/shared/ratings/ratings'

export type DetailsPage = Omit<Page, 'startHref' | 'toc'>

export interface PageNotice {
  kind: 'success' | 'error'
  text: string
  testId: string
}

const languageName = (tag: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag
  } catch {
    return tag
  }
}

function LocalDate({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
    </time>
  )
}

function FactValue({ fact }: { fact: PrivateBookFact }) {
  if (fact.format === 'language') return <>{languageName(fact.value)}</>
  if (fact.format === 'date') return <LocalDate iso={fact.value} />
  return <>{fact.value}</>
}

const link = 'font-semibold text-ink underline decoration-line underline-offset-4 transition hover:decoration-accent'

export function BookHeader({
  page,
  eyebrow,
  titleTestId,
  narrator,
  children,
}: {
  page: DetailsPage
  eyebrow: string
  titleTestId: string
  narrator?: string | null
  children: ReactNode
}) {
  const colors = HUE_CLASSES[PRIVATE_SHELF_HUE]
  const first = page.aboutParagraphs[0]
  return (
    <section
      aria-labelledby="book-title"
      className={cn(
        'mt-5 grid gap-8 rounded-[24px] border p-6 md:grid-cols-[220px_1fr] md:p-10 xl:grid-cols-[220px_1fr_260px] xl:items-end xl:gap-10',
        colors.tint,
      )}
    >
      <BookCover
        title={page.title}
        author={page.author}
        cover={page.cover}
        image={page.image}
        priority
        transitionName={`cover-${page.slug}`}
        className="w-[150px] shadow-[0_12px_28px_-14px_rgb(0_0_0/0.6)] md:w-[220px]"
      />
      <div className="min-w-0 self-end">
        <p className={cn('eyebrow', colors.ink)}>{eyebrow}</p>
        <h1
          id="book-title"
          data-testid={titleTestId}
          className="mt-3 font-display text-[clamp(34px,4vw,52px)] leading-[1.05] font-bold tracking-[-0.03em] text-balance break-words text-ink"
        >
          {page.title}
        </h1>
        <p className="mt-2 text-[15px] text-muted">{page.author}</p>
        {narrator && <p className="mt-1 text-[15px] text-muted">Read by {narrator}</p>}
        {page.article && <ArticleLine article={page.article} />}
        {first ? (
          <>
            <p className="mt-4 line-clamp-5 max-w-[56ch] text-[16.5px] leading-relaxed break-words text-body">
              {first}
            </p>
            {page.hasMore && (
              <a
                href="#about"
                className={cn('mt-2 inline-block text-[15px]', link)}
                data-testid="private-book-read-more"
              >
                Read more
              </a>
            )}
          </>
        ) : (
          <p className="mt-4 text-[16px] text-subtle">
            No description yet.{' '}
            <a href="#details" className={link} data-testid="private-book-add-description">
              Add one
            </a>
          </p>
        )}
        {children}
      </div>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3 md:col-span-2 xl:col-span-1 xl:grid-cols-1">
        {page.facts.map((fact) => (
          <div
            key={fact.label}
            className="rounded-2xl bg-surface/70 p-5"
            data-testid="private-book-fact"
            data-key={fact.label}
          >
            <dt className="text-[13px] text-subtle">{fact.label}</dt>
            <dd className="mt-1 font-display text-[18px] font-semibold break-words text-ink">
              <FactValue fact={fact} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function ArticleLine({ article }: { article: NonNullable<Page['article']> }) {
  return (
    <p className="mt-1 text-[15px] text-muted" data-testid="article-line">
      From {article.site} · saved <LocalDate iso={article.savedAt} /> · {readTimeText(article.words)} ·{' '}
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={link}
        data-testid="article-original"
      >
        Original article
      </a>
    </p>
  )
}

function Header({ page, rating }: { page: Page; rating: RatingState }) {
  return (
    <BookHeader page={page} eyebrow={page.article ? 'Article' : 'My shelf'} titleTestId="private-book-title">
      <StartOrContinue slug={page.slug} startHref={page.startHref}>
        <ReadAloudButton slug={page.slug} />
        <AddToShelf slug={page.slug} />
        <DownloadButton slug={page.slug} title={page.title} />
      </StartOrContinue>
      <BookRating slug={page.slug} rating={rating} />
    </BookHeader>
  )
}

export function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <div className="flex items-center gap-4">
      <h2 id={id} className="eyebrow text-ink">
        {children}
      </h2>
      <span className="h-px flex-1 bg-line" aria-hidden />
    </div>
  )
}

export function About({ page }: { page: DetailsPage }) {
  if (!page.aboutParagraphs.length) return null
  return (
    <section id="about" aria-labelledby="about-title" className="scroll-mt-[calc(var(--site-nav-h)+24px)]">
      <SectionTitle id="about-title">About this book</SectionTitle>
      <div className="mt-4 max-w-[68ch] space-y-4 text-[16.5px] leading-relaxed break-words text-body">
        {page.aboutParagraphs.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no id, and the list only changes as a whole
          <p key={i}>{p}</p>
        ))}
      </div>
      {page.openLibraryUrl && (
        <p className="mt-4 text-[13.5px] text-subtle">
          <a
            href={page.openLibraryUrl}
            rel="noreferrer"
            target="_blank"
            className="text-accent underline underline-offset-2"
            data-testid="private-book-open-library"
          >
            Details from Open Library
          </a>
        </p>
      )}
    </section>
  )
}

function Contents({ page }: { page: Page }) {
  return (
    <section aria-labelledby="toc-title">
      <SectionTitle id="toc-title">Contents</SectionTitle>
      <ol className="mt-4">
        {page.toc.map((c) => (
          <li key={c.href}>
            <AppLink
              href={c.href}
              preload={false}
              data-testid="private-book-chapter"
              data-key={c.number}
              className="group -mx-3 flex items-baseline gap-5 rounded-xl border-b border-line-soft px-3 py-3.5 transition hover:bg-panel"
            >
              <span className="w-7 shrink-0 text-[14px] text-subtle tabular">{pad2(c.number)}</span>
              <span className="min-w-0 font-sans text-[16px] break-words text-ink transition group-hover:text-accent md:text-[17px]">
                {c.title}
              </span>
            </AppLink>
          </li>
        ))}
      </ol>
    </section>
  )
}

const inputClass =
  'mt-2 w-full rounded-xl border border-line bg-page px-4 text-[16px] text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15 aria-[invalid=true]:border-red-500'

function DetailsForm({ page }: { page: DetailsPage }) {
  const [description, setDescription] = useState(page.details.description ?? '')
  const [isbn, setIsbn] = useState(page.details.isbn ?? '')
  const badIsbn = isBadIsbn(isbn)
  const nextYear = new Date().getFullYear() + 1
  return (
    <form method="post" className="mt-6 grid gap-5" onSubmit={(e) => badIsbn && e.preventDefault()}>
      <input type="hidden" name="intent" value="details" />
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-[14px] font-medium text-ink">
          Title
          <input
            name="title"
            required
            maxLength={300}
            defaultValue={page.title}
            className={cn(inputClass, 'h-12')}
            data-testid="private-book-details-title"
          />
        </label>
        <label className="block text-[14px] font-medium text-ink">
          Author
          <input
            name="author"
            required
            maxLength={200}
            defaultValue={page.author}
            className={cn(inputClass, 'h-12')}
            data-testid="private-book-details-author"
          />
        </label>
      </div>
      <div>
        <label htmlFor="details-description" className="block text-[14px] font-medium text-ink">
          Description
        </label>
        <textarea
          id="details-description"
          name="description"
          rows={5}
          maxLength={DESCRIPTION_MAX}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-describedby="details-description-count"
          className={cn(inputClass, 'py-3 leading-relaxed')}
          data-testid="private-book-details-description"
        />
        <p
          id="details-description-count"
          className="mt-1 text-[13px] text-muted tabular"
          data-testid="private-book-details-description-count"
        >
          {description.length.toLocaleString('en-GB')} of {DESCRIPTION_MAX.toLocaleString('en-GB')}
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-[1fr_1fr_120px]">
        <div>
          <label htmlFor="details-isbn" className="block text-[14px] font-medium text-ink">
            ISBN
          </label>
          <input
            id="details-isbn"
            name="isbn"
            inputMode="numeric"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            aria-invalid={badIsbn || undefined}
            aria-describedby={badIsbn ? 'details-isbn-error' : undefined}
            className={cn(inputClass, 'h-12')}
            data-testid="private-book-details-isbn"
          />
          {badIsbn && (
            <p
              id="details-isbn-error"
              className="mt-1 text-[13px] text-red-700 dark:text-red-300"
              data-testid="private-book-details-isbn-error"
            >
              Not a valid ISBN.
            </p>
          )}
        </div>
        <label className="block text-[14px] font-medium text-ink">
          Publisher
          <input
            name="publisher"
            maxLength={PUBLISHER_MAX}
            defaultValue={page.details.publisher ?? ''}
            className={cn(inputClass, 'h-12')}
            data-testid="private-book-details-publisher"
          />
        </label>
        <label className="block text-[14px] font-medium text-ink">
          Year
          <input
            name="year"
            inputMode="numeric"
            pattern="[0-9]{1,4}"
            min={1}
            max={nextYear}
            defaultValue={page.details.publishedYear ?? ''}
            className={cn(inputClass, 'h-12')}
            data-testid="private-book-details-year"
          />
        </label>
      </div>
      <div>
        <Button data-testid="private-book-details-save">Save details</Button>
      </div>
    </form>
  )
}

const FAILURE_TEXT = {
  not_found: 'This book isn’t on your shelf any more.',
  signed_out: 'You’ve been signed out. Sign in and try again.',
  unavailable: 'Something went wrong. Try again in a few minutes.',
} as const

function appliedText({ changed }: Applied): string {
  if (changed.cover && changed.description) return 'Cover and description added.'
  if (changed.cover) return 'Cover added.'
  if (changed.description) return 'Description added.'
  return 'That match had nothing new to add.'
}

export function useCoverActions(page: DetailsPage) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState(false)
  const findButton = useRef<HTMLButtonElement>(null)

  async function choose(file: File) {
    setError(null)
    setBusy('Saving the cover…')
    const drawn = await drawCover(file)
    if ('problem' in drawn) {
      setBusy(null)
      setError(IMAGE_PROBLEM_TEXT[drawn.problem])
      return
    }
    const saved = await uploadCover(page.id, drawn.blob, 'upload')
    if (!saved.ok) {
      setBusy(null)
      const p = saved.problem
      setError(p === 'small' || p === 'unreadable' ? IMAGE_PROBLEM_TEXT[p] : FAILURE_TEXT[p])
      return
    }
    await router.invalidate()
    setBusy(null)
    toast('Cover saved.')
  }

  function open() {
    setPanel(true)
  }

  function close() {
    setPanel(false)
    requestAnimationFrame(() => findButton.current?.focus())
  }

  async function applied(result: Applied) {
    await router.invalidate()
    if (result.coverProblem) return
    setPanel(false)
    toast(appliedText(result))
    requestAnimationFrame(() => document.getElementById('details-title')?.focus())
  }

  return { busy, error, panel, findButton, choose, open, close, applied }
}

export type CoverActions = ReturnType<typeof useCoverActions>

function FindButton({ actions }: { actions: CoverActions }) {
  return (
    <button
      ref={actions.findButton}
      type="button"
      className={chooserButton}
      aria-expanded={actions.panel}
      onClick={() => (actions.panel ? actions.close() : actions.open())}
      disabled={Boolean(actions.busy)}
      data-testid="book-lookup-open"
    >
      <Search className="size-4" aria-hidden />
      Find cover and details
    </button>
  )
}

export function CoverAndDetails({ page, actions }: { page: DetailsPage; actions: CoverActions | null }) {
  const source =
    page.coverSource === 'open-library' && page.openLibraryUrl ? (
      <a
        href={page.openLibraryUrl}
        rel="noreferrer"
        target="_blank"
        className="underline underline-offset-2"
        data-testid="cover-open-library"
      >
        Cover from Open Library
      </a>
    ) : (
      coverSourceText(page.coverSource)
    )
  return (
    <section id="details" aria-labelledby="details-title" className="scroll-mt-[calc(var(--site-nav-h)+24px)]">
      <h2
        id="details-title"
        tabIndex={-1}
        className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink outline-none"
      >
        Cover and details
      </h2>
      <div className="mt-4 rounded-[22px] border border-line bg-surface p-5 md:p-6">
        <h3 className="text-[15px] font-semibold text-ink">Cover</h3>
        <div className="mt-3">
          <CoverChooser
            title={page.title}
            author={page.author}
            style={page.cover}
            cover={page.image}
            sourceText={source}
            onChoose={actions ? (file) => void actions.choose(file) : undefined}
            busy={actions?.busy}
            error={actions?.error}
          >
            {actions && !page.article && <FindButton actions={actions} />}
            {!actions && (
              <p className="text-[14.5px] font-medium text-ink">
                {page.article
                  ? 'Choosing an image needs JavaScript.'
                  : 'Choosing an image and finding details need JavaScript.'}
              </p>
            )}
            {page.image && (
              <form method="post">
                <input type="hidden" name="intent" value="remove-cover" />
                <button type="submit" className={chooserButton} data-testid="cover-use-generated">
                  <X className="size-4" aria-hidden />
                  Use the generated cover
                </button>
              </form>
            )}
          </CoverChooser>
        </div>
        {actions?.panel && (
          <LookupPanel
            book={{ id: page.id, title: page.title, author: page.author, isbn: page.details.isbn }}
            onApplied={(result) => void actions.applied(result)}
            onClose={actions.close}
          />
        )}
        <h3 className="mt-8 text-[15px] font-semibold text-ink">Details</h3>
        <DetailsForm page={page} />
      </div>
    </section>
  )
}

const DELETE_TEXT = 'Deleted books are removed at once. Nightly backups keep a copy for up to 14 days.'

export function DeleteBook({ page, text }: { page: DetailsPage; text?: string }) {
  const article = Boolean(page.article)
  return (
    <section aria-labelledby="delete-title" className="mt-12">
      <SectionTitle id="delete-title">{article ? 'Delete this article' : 'Delete this book'}</SectionTitle>
      <form method="post" action={article ? ARTICLES_HREF : MY_BOOKS_HREF} className="mt-4">
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="id" value={page.id} />
        <Button variant="danger" data-testid="private-book-delete">
          Delete<span className="sr-only"> {page.title}</span>
        </Button>
      </form>
      <p className="mt-4 text-[13.5px] text-muted">{text ?? (article ? DELETE_NOTE : DELETE_TEXT)}</p>
    </section>
  )
}

export function CoverPrompt({ actions }: { actions: CoverActions }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <aside
      aria-label="No cover yet"
      data-testid="cover-prompt"
      className="mt-8 flex flex-wrap items-center gap-4 rounded-[22px] border border-line bg-surface p-5"
    >
      <p className="min-w-0 flex-[1_1_200px] text-[15px] font-medium text-ink">This book has no cover yet.</p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={chooserButton}
          data-testid="cover-prompt-find"
          onClick={() => {
            actions.open()
            requestAnimationFrame(() => document.getElementById('details')?.scrollIntoView({ block: 'start' }))
          }}
        >
          <Search className="size-4" aria-hidden />
          Find cover and details
        </button>
        <ChooseImageButton onChoose={(file) => void actions.choose(file)} busy={actions.busy} />
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        data-testid="cover-prompt-dismiss"
        className="ml-auto inline-flex h-11 items-center rounded-xl px-3 text-[14px] font-medium text-muted transition hover:bg-panel hover:text-ink"
      >
        Not now
      </button>
    </aside>
  )
}

export function PrivateBookPage({ page, notices, rating }: { page: Page; notices: PageNotice[]; rating: RatingState }) {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const actions = useCoverActions(page)
  return (
    <main id="main" className="page-wrap pt-7" style={{ paddingBottom: 'var(--player-h)' }}>
      {page.article ? (
        <BackLink href={ARTICLES_HREF} label="Articles" />
      ) : (
        <BackLink href={MY_BOOKS_HREF} label="My books" />
      )}
      {notices.map((n) => (
        <Notice key={n.text} kind={n.kind} data-testid={n.testId}>
          {n.text}
        </Notice>
      ))}
      <Header page={page} rating={rating} />
      {hydrated && !page.image && !page.article && <CoverPrompt actions={actions} />}
      <div className="grid gap-12 py-12">
        <About page={page} />
        <Contents page={page} />
        <CoverAndDetails page={page} actions={hydrated ? actions : null} />
      </div>
      <DeleteBook page={page} />
    </main>
  )
}
