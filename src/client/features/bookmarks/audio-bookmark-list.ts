import {
  type CollectionSnapshot,
  type CollectionState,
  type Entry,
  itemsUnder,
  type NamedLoadAnswer,
  OptimisticCollection,
} from '~/client/lib/optimistic-collection'
import { type AudioBookmarkView, type EpisodeRef, inListeningOrder, type VoicePlace } from '~/shared/bookmarks/audio'
import type { AudioBookmarkRequest } from './audio-bookmarks-client'
import type { BookmarkProblem, BookmarkResult } from './bookmarks-client'

/** Audio bookmarks are never off: the player shows them wherever it plays. */
export type AudioBookmarksState = Exclude<CollectionState, 'off'>

export type AudioBookmarkItem = Entry<AudioBookmarkView>

export interface AudioSnapshot extends CollectionSnapshot<AudioBookmarkView> {
  state: AudioBookmarksState
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

export type AudioLoadAnswer = NamedLoadAnswer<'bookmarks', AudioBookmarkView>

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

/** The reader's audio bookmarks in one book. */
export class AudioBookmarkList extends OptimisticCollection<AudioBookmarkView, NewAudioBookmark, BookmarkProblem> {
  constructor(
    readonly book: string,
    private readonly deps: AudioDeps,
    state: AudioBookmarksState,
  ) {
    super(
      {
        load: () => itemsUnder('bookmarks', deps.load(book)),
        create: async (input) => {
          const result = await deps.create(input.request)
          if (result.ok) return { ok: true, value: result.value.bookmark }
          return { ok: false, problem: result.problem === 'not_found' ? 'failed' : result.problem }
        },
        remove: deps.remove,
        removed: () => deps.toast('Bookmark removed'),
        draft: (input, key) => ({ ...input.view, id: key, status: 'ok', createdAt: new Date().toISOString() }),
        refused: (problem) => deps.toast(AUDIO_PROBLEM_TEXT[problem]),
        order: ordered,
      },
      state,
    )
  }

  /** Never off: the list starts in an `AudioBookmarksState`, and `start` takes no `embedded`. */
  override getSnapshot = (): AudioSnapshot => this.snapshot as AudioSnapshot

  override start({ signedIn }: { signedIn: boolean }): void {
    super.start({ signedIn })
  }

  /** Bookmarks the moment and says so; nothing while the reader is signed out. */
  async bookmark(input: NewAudioBookmark): Promise<void> {
    if (this.state === 'signed_out') return
    const { saved } = this.add(input)
    this.deps.toast(`Moment bookmarked · ${input.label}`)
    await saved
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
