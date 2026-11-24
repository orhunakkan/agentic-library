import {
  type CollectionSnapshot,
  type Entry,
  itemsUnder,
  type NamedLoadAnswer,
  OptimisticCollection,
} from '~/client/lib/optimistic-collection'
import type { ChangeResult } from '~/client/lib/post'
import type { PagePosition } from '~/shared/content/position'
import { DEFAULT_COLOR, type HighlightColor } from '~/shared/highlights/colors'
import type { HighlightPlace, HighlightView } from '~/shared/highlights/group'
import { MAX_HIGHLIGHTS_PER_USER } from '~/shared/highlights/limits'
import { highlightQuotaCopy } from '~/shared/plans/copy'
import { FREE_LIMITS } from '~/shared/plans/plans'
import type { HighlightProblem, NewHighlightRequest } from './highlights-client'

export type HighlightsState = CollectionSnapshot<HighlightView>['state']

export type HighlightItem = Entry<HighlightView>

export interface HighlightsSnapshot extends CollectionSnapshot<HighlightView> {
  /** The color the next highlight is made in: the last one the reader picked. */
  color: HighlightColor
}

export const PROBLEM_TEXT: Record<HighlightProblem, string> = {
  'quota-book': 'You’ve reached 1,000 highlights in this book.',
  'quota-user': highlightQuotaCopy('pro', MAX_HIGHLIGHTS_PER_USER),
  'quota-free': highlightQuotaCopy('free', FREE_LIMITS.highlights),
  pro: 'Couldn’t save that. Try again.',
  stale: 'This page changed since it loaded. Reload it to highlight.',
  signed_out: 'You’ve been signed out. Sign in to keep highlights.',
  not_found: 'That highlight was already deleted.',
  failed: 'Couldn’t save that. Try again.',
}

export interface NewHighlight {
  position: PagePosition
  start: number
  end: number
  text: string
  place: Omit<HighlightPlace, 'href'>
}

export type HighlightLoadAnswer = NamedLoadAnswer<'highlights', HighlightView>

type HighlightChange = { color?: HighlightColor; note?: string | null }

export interface HighlightDeps {
  load: (book: string) => Promise<HighlightLoadAnswer>
  create: (request: NewHighlightRequest) => Promise<ChangeResult<HighlightView, HighlightProblem>>
  update: (id: string, change: HighlightChange) => Promise<ChangeResult<HighlightView, HighlightProblem>>
  remove: (id: string) => Promise<ChangeResult<true, HighlightProblem>>
  toast: (text: string) => void
}

/** The reader's highlights in one book, and the color the next one is made in. */
export class HighlightList extends OptimisticCollection<
  HighlightView,
  NewHighlight & { color: HighlightColor },
  HighlightProblem,
  { color: HighlightColor }
> {
  constructor(
    book: string,
    private readonly deps: HighlightDeps,
    state: HighlightsState,
  ) {
    super(
      {
        load: () => itemsUnder('highlights', deps.load(book)),
        create: ({ position, start, end, text, color }) => deps.create({ book, position, start, end, text, color }),
        update: deps.update,
        remove: deps.remove,
        removed: () => deps.toast('Highlight deleted'),
        draft: (input, key) => {
          const now = new Date().toISOString()
          return {
            id: key,
            color: input.color,
            note: null,
            text: input.text,
            status: 'ok',
            place: { ...input.place, href: input.place.pageHref },
            createdAt: now,
            updatedAt: now,
          }
        },
        refused: (problem) => deps.toast(PROBLEM_TEXT[problem]),
        settle: (shown, saved) => ({ ...saved, color: shown.color, note: shown.note }),
      },
      state,
      { color: DEFAULT_COLOR },
    )
  }

  /** Shows the new highlight at once, in the current color, and returns the key it is shown by. */
  create(input: NewHighlight): string {
    return this.add({ ...input, color: this.snapshot.color }).key
  }

  recolor(key: string, color: HighlightColor): void {
    this.extend({ color })
    void this.update(key, { color })
  }

  async saveNote(key: string, note: string): Promise<boolean> {
    const text = note.trim()
    const ok = await this.update(key, { note: text || null })
    if (ok) this.deps.toast('Note saved')
    return ok
  }
}
