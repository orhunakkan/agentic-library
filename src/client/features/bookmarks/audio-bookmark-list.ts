import {
  type CollectionSnapshot,
  type CollectionState,
  type Entry,
  OptimisticCollection,
} from '~/client/lib/optimistic-collection'
import { type AudioBookmarkView, type EpisodeRef, inListeningOrder, type VoicePlace } from '~/shared/bookmarks/audio'
import type { AudioBookmarkRequest } from './audio-bookmarks-client'
import type { BookmarkProblem, BookmarkResult } from './bookmarks-client'

/** Audio bookmarks are never off: the player shows them wherever it plays. */
export type AudioBookmarksState = Exclude<CollectionState, 'off'>

export type AudioBookmarkItem = Entry<AudioBookmarkView>

export type AudioSnapshot = CollectionSnapshot<AudioBookmarkView>

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

const ordered = (items: readonly AudioBookmarkItem[]) => [
  ...inListeningOrder(items.filter((b) => !b.pending)),
  ...items.filter((b) => b.pending),
]

export class AudioBookmarkList {
  private readonly list: OptimisticCollection<AudioBookmarkView, NewAudioBookmark, BookmarkProblem>

  constructor(
    readonly book: string,
    private readonly deps: AudioDeps,
    state: AudioBookmarksState,
  ) {
    this.list = new OptimisticCollection(
      {
        load: async () => {
          const answer = await deps.load(book)
          return answer.state === 'ready' ? { state: 'ready', items: answer.bookmarks } : answer
        },
        create: async (input) => {
          const result = await deps.create(input.request)
          if (result.ok) return { ok: true, value: result.value.bookmark }
          return { ok: false, problem: result.problem === 'not_found' ? 'failed' : result.problem }
        },
        remove: deps.remove,
        draft: (input, key) =>
          ({ ...input.view, id: key, status: 'ok', createdAt: new Date().toISOString() }) as AudioBookmarkView,
        refused: (problem) => deps.toast(AUDIO_PROBLEM_TEXT[problem]),
        order: ordered,
      },
      state,
    )
  }

  subscribe = (listener: () => void): (() => void) => this.list.subscribe(listener)

  getSnapshot = (): AudioSnapshot => this.list.getSnapshot()

  start({ signedIn }: { signedIn: boolean }): void {
    this.list.start({ signedIn })
  }

  load(): Promise<void> {
    return this.list.load()
  }

  retry(): void {
    this.list.retry()
  }

  async add(input: NewAudioBookmark): Promise<void> {
    if (this.list.state === 'signed_out') return
    const { saved } = this.list.add(input)
    this.deps.toast(`Moment bookmarked · ${input.label}`)
    await saved
  }

  async remove(key: string): Promise<void> {
    if (!this.list.find(key)) return
    const removing = this.list.remove(key)
    this.deps.toast('Bookmark removed')
    await removing
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
