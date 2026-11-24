import {
  type CollectionSnapshot,
  type Entry,
  itemsUnder,
  type NamedLoadAnswer,
  OptimisticCollection,
} from '~/client/lib/optimistic-collection'
import { type BookmarkPlace, type BookmarkView, onPage } from '~/shared/bookmarks/bookmarks'
import type { PagePosition } from '~/shared/content/position'
import type { BookmarkProblem, BookmarkResult } from './bookmarks-client'

export type BookmarksState = CollectionSnapshot<BookmarkView>['state']

export type BookmarkItem = Entry<BookmarkView>

export type Snapshot = CollectionSnapshot<BookmarkView>

export interface NewBookmark {
  position: PagePosition
  place: BookmarkPlace
}

export const PROBLEM_TEXT: Record<BookmarkProblem, string> = {
  'quota-book': 'You’ve reached 1,000 bookmarks in this book.',
  'quota-user': 'You’ve reached 10,000 bookmarks.',
  signed_out: 'You’ve been signed out. Sign in to keep bookmarks.',
  not_found: 'That bookmark was already removed.',
  failed: 'Couldn’t save that. Try again.',
}

export type LoadAnswer = NamedLoadAnswer<'bookmarks', BookmarkView>

export interface Deps {
  load: (book: string) => Promise<LoadAnswer>
  create: (request: {
    book: string
    position: PagePosition
  }) => Promise<BookmarkResult<{ bookmark: BookmarkView; created: boolean }>>
  remove: (id: string) => Promise<BookmarkResult<true>>
  toast: (text: string) => void
}

/** The reader's page bookmarks in one book; the ribbon toggles the one on the page. */
export class BookmarkList extends OptimisticCollection<BookmarkView, NewBookmark, BookmarkProblem> {
  constructor(
    book: string,
    private readonly deps: Deps,
    state: BookmarksState,
  ) {
    super(
      {
        load: () => itemsUnder('bookmarks', deps.load(book)),
        create: async (input) => {
          const result = await deps.create({ book, position: input.position })
          return result.ok ? { ok: true, value: result.value.bookmark } : result
        },
        remove: deps.remove,
        removed: () => deps.toast('Bookmark removed'),
        draft: (input, key) => ({
          id: key,
          status: 'ok',
          opening: '',
          place: input.place,
          createdAt: new Date().toISOString(),
        }),
        refused: (problem) => deps.toast(PROBLEM_TEXT[problem]),
      },
      state,
    )
  }

  toggle(input: NewBookmark): Promise<void> {
    if (this.state !== 'ready') return Promise.resolve()
    const here = onPage(this.snapshot.items, input.place.pageHref)
    return here.length ? this.remove(here.map((b) => b.key)) : this.create(input)
  }

  private async create(input: NewBookmark): Promise<void> {
    const { saved } = this.add(input)
    this.deps.toast('Page bookmarked')
    await saved
  }
}
