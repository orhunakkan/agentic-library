import { type AudioBookmarkView, type EpisodeRef, inListeningOrder, type VoicePlace } from '~/shared/bookmarks/audio'
import type { AudioBookmarkRequest } from './audio-bookmarks-client'
import type { BookmarkProblem, BookmarkResult } from './bookmarks-client'

export type AudioBookmarksState = 'signed_out' | 'loading' | 'ready' | 'unavailable'

export type AudioBookmarkItem = AudioBookmarkView & { key: string; pending: boolean }

export interface AudioSnapshot {
  state: AudioBookmarksState
  items: AudioBookmarkItem[]
}

export interface NewAudioBookmark {
  request: AudioBookmarkRequest
  view:
    | { kind: 'voice'; opening: string; place: VoicePlace | null }
    | { kind: 'episode'; positionMs: number; episode: EpisodeRef | null }
  label: string
}

export const AUDIO_PROBLEM_TEXT: Record<BookmarkProblem, string> = {
  'quota-book': 'You’ve reached 1,000 audio bookmarks in this book.',
  'quota-user': 'You’ve reached 10,000 audio bookmarks.',
  signed_out: 'You’ve been signed out. Sign in to keep bookmarks.',
  not_found: 'That bookmark was already removed.',
  failed: 'Couldn’t save that. Try again.',
}

export type AudioLoadAnswer =
  | { state: 'ready'; bookmarks: AudioBookmarkView[] }
  | { state: 'signed_out' | 'not_found' | 'unavailable' }

export interface AudioDeps {
  load: (book: string) => Promise<AudioLoadAnswer>
  create: (request: AudioBookmarkRequest) => Promise<BookmarkResult<{ bookmark: AudioBookmarkView; created: boolean }>>
  remove: (id: string) => Promise<BookmarkResult<true>>
  toast: (text: string) => void
}

const asItem = (b: AudioBookmarkView): AudioBookmarkItem => ({ ...b, key: b.id, pending: false })

const ordered = (items: readonly AudioBookmarkItem[]) => [
  ...inListeningOrder(items.filter((b) => !b.pending)),
  ...items.filter((b) => b.pending),
]

export class AudioBookmarkList {
  private snapshot: AudioSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly ids = new Map<string, Promise<string | null>>()
  private readonly made = new Map<string, AudioBookmarkItem>()
  private counter = 0
  private generation = 0

  constructor(
    readonly book: string,
    private readonly deps: AudioDeps,
    state: AudioBookmarksState,
  ) {
    this.snapshot = { state, items: [] }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): AudioSnapshot => this.snapshot

  private set(next: Partial<AudioSnapshot>) {
    const items = next.items ? ordered(next.items) : this.snapshot.items
    this.snapshot = { ...this.snapshot, ...next, items }
    for (const listener of this.listeners) listener()
  }

  private setItems(change: (items: AudioBookmarkItem[]) => AudioBookmarkItem[]) {
    this.set({ items: change(this.snapshot.items) })
  }

  start({ signedIn }: { signedIn: boolean }): void {
    this.generation++
    this.made.clear()
    if (!signedIn) this.set({ state: 'signed_out', items: [] })
    else {
      this.set({ state: 'loading', items: [] })
      void this.load()
    }
  }

  async load(): Promise<void> {
    const generation = this.generation
    let answer: AudioLoadAnswer
    try {
      answer = await this.deps.load(this.book)
    } catch {
      answer = { state: 'unavailable' }
    }
    if (generation !== this.generation) return
    if (answer.state === 'ready') {
      const ids = new Set(answer.bookmarks.map((b) => b.id))
      const kept = this.snapshot.items.filter((b) => b.pending || (this.made.has(b.key) && !ids.has(b.id)))
      this.set({ state: 'ready', items: [...answer.bookmarks.map(asItem), ...kept] })
    } else this.set({ state: answer.state === 'signed_out' ? 'signed_out' : 'unavailable' })
  }

  retry(): void {
    this.set({ state: 'loading' })
    void this.load()
  }

  private failed(problem: BookmarkProblem) {
    this.deps.toast(AUDIO_PROBLEM_TEXT[problem])
    if (problem === 'signed_out') this.set({ state: 'signed_out' })
  }

  async add(input: NewAudioBookmark): Promise<void> {
    if (this.snapshot.state === 'signed_out') return
    const key = `new-${++this.counter}`
    const item = {
      ...input.view,
      key,
      id: key,
      pending: true,
      status: 'ok',
      createdAt: new Date().toISOString(),
    } as AudioBookmarkItem
    this.setItems((items) => [...items, item])
    this.deps.toast(`Moment bookmarked · ${input.label}`)
    const generation = this.generation
    const saved = this.deps.create(input.request).then((result) => {
      if (generation !== this.generation) return null
      if (!result.ok) {
        this.setItems((items) => items.filter((b) => b.key !== key))
        this.failed(result.problem === 'not_found' ? 'failed' : result.problem)
        return null
      }
      const { bookmark } = result.value
      const entry: AudioBookmarkItem = { ...bookmark, key, pending: false }
      this.made.set(key, entry)
      this.setItems((items) =>
        items.flatMap((b) => {
          if (b.key === key) return [entry]
          return b.id === bookmark.id ? [] : [b]
        }),
      )
      return bookmark.id
    })
    this.ids.set(key, saved)
    await saved
  }

  private idOf(key: string): Promise<string | null> {
    return this.ids.get(key) ?? Promise.resolve(key)
  }

  async remove(key: string): Promise<void> {
    const item = this.snapshot.items.find((b) => b.key === key)
    if (!item) return
    this.setItems((items) => items.filter((b) => b.key !== key))
    this.made.delete(key)
    this.deps.toast('Bookmark removed')
    const id = await this.idOf(key)
    if (!id) return
    const result = await this.deps.remove(id)
    if (result.ok) return
    if (result.problem !== 'not_found') this.setItems((items) => [...items, item])
    this.failed(result.problem)
  }
}

export class AudioBookmarkRegistry {
  private readonly lists = new Map<string, { list: AudioBookmarkList; signedIn: boolean | null }>()

  constructor(private readonly deps: AudioDeps) {}

  private entryFor(book: string, signedIn: boolean) {
    let entry = this.lists.get(book)
    if (!entry) {
      entry = { list: new AudioBookmarkList(book, this.deps, signedIn ? 'loading' : 'signed_out'), signedIn: null }
      this.lists.set(book, entry)
    }
    return entry
  }

  listFor(book: string, signedIn: boolean): AudioBookmarkList {
    return this.entryFor(book, signedIn).list
  }

  sync(book: string, signedIn: boolean): void {
    if (!signedIn) {
      for (const entry of this.lists.values()) {
        if (entry.signedIn === false) continue
        entry.signedIn = false
        entry.list.start({ signedIn: false })
      }
      return
    }
    const entry = this.entryFor(book, true)
    if (entry.signedIn === true) return
    entry.signedIn = true
    entry.list.start({ signedIn: true })
  }
}

export function reloadWhenBack(reload: () => void, afterMs: number, now: () => number = Date.now) {
  let hiddenAt = 0
  return (visibility: DocumentVisibilityState) => {
    if (visibility === 'hidden') hiddenAt = now()
    else if (hiddenAt && now() - hiddenAt >= afterMs) reload()
  }
}
