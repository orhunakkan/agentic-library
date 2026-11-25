import { Link, useRouteContext } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { TAB_MESSAGE, TabNotice } from '~/client/features/reader/TabNotice'
import { cn } from '~/client/lib/cn'
import type { ReaderView } from '~/shared/content/reader-view'
import { COLOR_NAMES } from '~/shared/highlights/colors'
import { groupByChapter, type HighlightView, inReadingOrder } from '~/shared/highlights/group'
import { SWATCH } from './HighlightPopover'
import { NoteEditor } from './NoteEditor'
import type { HighlightItem, HighlightsApi } from './use-highlights'

export interface Editing {
  key: string
  focus: boolean
}

export function HighlightsTab({
  api,
  view,
  editing,
  setEditing,
  onNavigate,
  offline = false,
}: {
  api: HighlightsApi
  view: ReaderView
  editing: Editing | null
  setEditing: (editing: Editing | null) => void
  onNavigate?: () => void
  offline?: boolean
}) {
  const id = useId()
  const canExport = useRouteContext({ from: '__root__' }).viewer?.plan === 'pro'
  if (offline || api.state !== 'ready')
    return (
      <TabNotice
        name="highlights"
        state={api.state}
        offline={offline}
        signInText="Sign in to highlight passages and keep notes on this book."
        next={view.canonicalPath}
        onRetry={api.retry}
      />
    )

  const all = inReadingOrder(api.items) as HighlightItem[]
  const here = all.filter((h) => h.place?.pageHref === view.canonicalPath)
  const { chapters, missing } = groupByChapter(all.filter((h) => !here.includes(h)))
  const entry = (highlight: HighlightView) => {
    const item = highlight as HighlightItem
    return (
      <Entry
        key={item.key}
        item={item}
        api={api}
        editing={editing?.key === item.key ? editing : null}
        setEditing={setEditing}
        onNavigate={onNavigate}
      />
    )
  }

  return (
    <div className="space-y-6 px-2 pt-2 pb-4">
      {all.length === 0 && (
        <p data-testid="highlights-empty" className={TAB_MESSAGE}>
          Select text on the page to highlight it or add a note.
        </p>
      )}
      {here.length > 0 && (
        <section aria-labelledby={`${id}-here`}>
          <h3 id={`${id}-here`} className="eyebrow mb-2 px-1 text-r-muted">
            On this page
          </h3>
          <ul className="space-y-2">{here.map(entry)}</ul>
        </section>
      )}
      {chapters.map((chapter) => (
        <section key={chapter.chapterIndex} aria-labelledby={`${id}-ch-${chapter.chapterIndex}`}>
          <h3 id={`${id}-ch-${chapter.chapterIndex}`} className="mb-2 px-1 text-[13px] font-semibold text-r-ink">
            <span className="mr-1.5 text-r-muted tabular">{chapter.chapterIndex + 1}.</span>
            {chapter.chapterTitle}
          </h3>
          <ul className="space-y-2">{chapter.highlights.map(entry)}</ul>
        </section>
      ))}
      {missing.length > 0 && (
        <section aria-labelledby={`${id}-missing`}>
          <h3 id={`${id}-missing`} className="mb-2 px-1 text-[13px] font-semibold text-r-ink">
            Passages no longer found
          </h3>
          <ul className="space-y-2">{missing.map(entry)}</ul>
        </section>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-r-line px-1 pt-4 text-[13.5px]">
        {canExport && (
          <a
            href={`/account/highlights/export/${view.book.slug}`}
            download
            data-testid="highlights-export"
            className="font-medium text-r-accent underline-offset-2 hover:underline"
          >
            Export as Markdown
          </a>
        )}
        <Link
          to="/account/highlights"
          data-testid="highlights-all"
          search={{ book: view.book.slug }}
          className="font-medium text-r-accent underline-offset-2 hover:underline"
        >
          All highlights
        </Link>
      </div>
    </div>
  )
}

function Entry({
  item,
  api,
  editing,
  setEditing,
  onNavigate,
}: {
  item: HighlightItem
  api: HighlightsApi
  editing: Editing | null
  setEditing: (editing: Editing | null) => void
  onNavigate?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const long = item.text.length > 260 || item.text.split('\n').length > 4
  const small =
    'inline-flex min-h-9 items-center rounded-full px-2.5 text-[12.5px] text-r-muted transition hover:bg-r-line/60 hover:text-r-ink'
  return (
    <li
      data-testid="highlight-item"
      data-key={item.key}
      className="flex gap-3 rounded-xl border border-r-line bg-r-paper py-2.5 pr-2 pl-3"
    >
      <span aria-hidden className={cn('w-1 shrink-0 rounded-full', SWATCH[item.color])} />
      <div className="min-w-0 flex-1">
        <span className="sr-only">{COLOR_NAMES[item.color]} highlight: </span>
        <p
          className={cn(
            'font-serif text-[14px] leading-[1.55] whitespace-pre-line text-r-ink [overflow-wrap:anywhere]',
            !expanded && 'line-clamp-4',
          )}
        >
          {item.text}
        </p>
        {long && (
          <button
            type="button"
            data-testid="highlight-show-more"
            data-key={item.key}
            onClick={() => setExpanded((e) => !e)}
            className={cn(small, '-ml-2.5')}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
        {item.status === 'missing' && (
          <p className="mt-1.5 text-[12.5px] text-r-muted">
            This passage changed or moved, so it can’t be shown on the page.
          </p>
        )}
        {editing ? (
          <NoteEditor
            initial={item.note ?? ''}
            autoFocus={editing.focus}
            onSave={async (note) => {
              const ok = await api.saveNote(item.key, note)
              if (ok) setEditing(null)
              return ok
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          item.note && (
            <p className="mt-1.5 text-[13.5px] leading-relaxed whitespace-pre-line text-r-muted [overflow-wrap:anywhere]">
              <span className="sr-only">Note: </span>
              {item.note}
            </p>
          )
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {item.place && (
            <AppLink
              href={item.place.href}
              data-testid="highlight-page-link"
              data-key={item.key}
              preload={false}
              onClick={onNavigate}
              className="mr-1 inline-flex min-h-9 items-center rounded-full bg-r-accent/12 px-2.5 text-[12px] font-medium text-r-accent transition hover:bg-r-accent/20"
            >
              {item.place.label}
            </AppLink>
          )}
          {item.status !== 'missing' && !editing && (
            <button
              type="button"
              data-testid="highlight-edit-note"
              data-key={item.key}
              onClick={() => setEditing({ key: item.key, focus: true })}
              className={small}
            >
              {item.note ? 'Edit note' : 'Add note'}
            </button>
          )}
          <button
            type="button"
            data-testid="highlight-delete"
            data-key={item.key}
            onClick={() => (item.note && !confirming ? setConfirming(true) : void api.remove(item.key))}
            onBlur={() => setConfirming(false)}
            className={cn(small, confirming && 'font-medium text-r-emph')}
          >
            {confirming ? 'Delete highlight and note?' : 'Delete'}
          </button>
        </div>
      </div>
    </li>
  )
}
