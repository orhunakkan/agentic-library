import { type CollectionSnapshot, type Entry, OptimisticCollection } from '~/client/lib/optimistic-collection'
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

export type LoadAnswer =
  | { state: 'ready'; bookmarks: BookmarkView[] }
  | { state: 'signed_out' | 'not_found' | 'unavailable' }

export interface Deps {
  load: (book: string) => Promise<LoadAnswer>
  create: (request: {
    book: string
    position: PagePosition
  }) => Promise<BookmarkResult<{ bookmark: BookmarkView; created: boolean }>>
  remove: (id: string) => Promise<BookmarkResult<true>>
  toast: (text: string) => void
}

export class BookmarkList {
  private readonly list: OptimisticCollection<BookmarkView, NewBookmark, BookmarkProblem>

  constructor(
    book: string,
    private readonly deps: Deps,
    state: BookmarksState,
  ) {
    this.list = new OptimisticCollection(
      {
        load: async () => {
          const answer = await deps.load(book)
          return answer.state === 'ready' ? { state: 'ready', items: answer.bookmarks } : answer
        },
        create: async (input) => {
          const result = await deps.create({ book, position: input.position })
          return result.ok ? { ok: true, value: result.value.bookmark } : result
        },
        remove: deps.remove,
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

  subscribe = (listener: () => void): (() => void) => this.list.subscribe(listener)

  getSnapshot = (): Snapshot => this.list.getSnapshot()

  start({ signedIn, embedded }: { signedIn: boolean; embedded: boolean }): void {
    this.list.start({ signedIn, embedded })
  }

  load(): Promise<void> {
    return this.list.load()
  }

  retry(): void {
    this.list.retry()
  }

  toggle(input: NewBookmark): Promise<void> {
    if (this.list.state !== 'ready') return Promise.resolve()
    const here = onPage(this.list.getSnapshot().items, input.place.pageHref)
    return here.length ? this.removeKeys(here.map((b) => b.key)) : this.create(input)
  }

  remove(key: string): Promise<void> {
    return this.removeKeys([key])
  }

  private async create(input: NewBookmark): Promise<void> {
    const { saved } = this.list.add(input)
    this.deps.toast('Page bookmarked')
    await saved
  }

  private async removeKeys(keys: readonly string[]): Promise<void> {
    if (!keys.some((key) => this.list.find(key))) return
    const removing = keys.map((key) => this.list.remove(key))
    this.deps.toast('Bookmark removed')
    await Promise.all(removing)
  }
}
