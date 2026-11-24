import { type BookmarkPlace, type BookmarkView, onPage } from '~/shared/bookmarks/bookmarks'
import type { PagePosition } from '~/shared/content/position'
import type { BookmarkProblem, BookmarkResult } from './bookmarks-client'

export type BookmarksState = 'off' | 'signed_out' | 'loading' | 'ready' | 'unavailable'

export interface BookmarkItem extends BookmarkView {
  key: string
  pending: boolean
}

export interface Snapshot {
  state: BookmarksState
  items: BookmarkItem[]
}

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

const asItem = (b: BookmarkView): BookmarkItem => ({ ...b, key: b.id, pending: false })

export class BookmarkList {
  private snapshot: Snapshot
  private readonly listeners = new Set<() => void>()
  private readonly ids = new Map<string, Promise<string | null>>()
  private counter = 0
  private generation = 0

  constructor(
    private readonly book: string,
    private readonly deps: Deps,
    state: BookmarksState,
  ) {
    this.snapshot = { state, items: [] }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): Snapshot => this.snapshot

  private set(next: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of this.listeners) listener()
  }

  private setItems(change: (items: BookmarkItem[]) => BookmarkItem[]) {
    this.set({ items: change(this.snapshot.items) })
  }

  start({ signedIn, embedded }: { signedIn: boolean; embedded: boolean }): void {
    this.generation++
    if (embedded) this.set({ state: 'off' })
    else if (!signedIn) this.set({ state: 'signed_out' })
    else {
      this.set({ state: 'loading', items: [] })
      void this.load()
    }
  }

  async load(): Promise<void> {
    const generation = this.generation
    let answer: LoadAnswer
    try {
      answer = await this.deps.load(this.book)
    } catch {
      answer = { state: 'unavailable' }
    }
    if (generation !== this.generation) return
    if (answer.state === 'ready') {
      const pending = this.snapshot.items.filter((b) => b.pending)
      this.set({ state: 'ready', items: [...answer.bookmarks.map(asItem), ...pending] })
    } else this.set({ state: answer.state === 'signed_out' ? 'signed_out' : 'unavailable' })
  }

  retry(): void {
    this.set({ state: 'loading' })
    void this.load()
  }

  private failed(problem: BookmarkProblem) {
    this.deps.toast(PROBLEM_TEXT[problem])
    if (problem === 'signed_out') this.set({ state: 'signed_out' })
  }

  private idOf(key: string): Promise<string | null> {
    return this.ids.get(key) ?? Promise.resolve(key)
  }

  toggle(input: NewBookmark): Promise<void> {
    if (this.snapshot.state !== 'ready') return Promise.resolve()
    const here = onPage(this.snapshot.items, input.place.pageHref)
    return here.length ? this.removeKeys(here.map((b) => b.key)) : this.create(input)
  }

  remove(key: string): Promise<void> {
    return this.removeKeys([key])
  }

  private async create(input: NewBookmark): Promise<void> {
    const key = `new-${++this.counter}`
    const item: BookmarkItem = {
      key,
      id: key,
      pending: true,
      status: 'ok',
      opening: '',
      place: input.place,
      createdAt: new Date().toISOString(),
    }
    this.setItems((items) => [...items, item])
    this.deps.toast('Page bookmarked')
    const saved = this.deps.create({ book: this.book, position: input.position }).then((result) => {
      if (!result.ok) {
        this.setItems((items) => items.filter((b) => b.key !== key))
        this.failed(result.problem)
        return null
      }
      const { bookmark } = result.value
      this.setItems((items) =>
        items.flatMap((b) => {
          if (b.key === key) return [{ ...bookmark, key, pending: false }]
          return b.id === bookmark.id ? [] : [b]
        }),
      )
      return bookmark.id
    })
    this.ids.set(key, saved)
    await saved
  }

  private async removeKeys(keys: readonly string[]): Promise<void> {
    const before = this.snapshot.items.filter((b) => keys.includes(b.key))
    if (!before.length) return
    this.setItems((items) => items.filter((b) => !keys.includes(b.key)))
    this.deps.toast('Bookmark removed')
    await Promise.all(
      before.map(async (item) => {
        const id = await this.idOf(item.key)
        if (!id) return
        const result = await this.deps.remove(id)
        if (result.ok) return
        if (result.problem !== 'not_found') this.setItems((items) => [...items, item])
        this.failed(result.problem)
      }),
    )
  }
}
