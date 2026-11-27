import { describe, expect, it, vi } from 'vitest'
import {
  AUDIO_PROBLEM_TEXT,
  AudioBookmarkList,
  AudioBookmarkRegistry,
  type AudioDeps,
  type AudioLoadAnswer,
  type NewAudioBookmark,
} from '~/client/features/bookmarks/audio-bookmark-list'
import type { BookmarkProblem } from '~/client/features/bookmarks/bookmarks-client'
import type { AudioBookmarkView, VoiceBookmarkView } from '~/shared/bookmarks/audio'

const ID = (n: number) => `6f1c0000-0000-4000-8000-00000000000${n}`

const place = (page: number, start: number) => ({
  chapterIndex: 5,
  chapterTitle: 'Chapter 6',
  chapter: 'chapter-6',
  page,
  pageHref: `/read/pride-and-prejudice/chapter-6/${page}`,
  label: `Ch. 6 · p. ${page}`,
  position: 40 + page,
  start,
})

const saved = (n: number, page: number, start = 0): VoiceBookmarkView => ({
  kind: 'voice',
  id: ID(n),
  status: 'ok',
  opening: `Sentence ${n}`,
  place: place(page, start),
  createdAt: `2026-11-05T10:0${n}:00.000Z`,
})

const moment = (page: number, offset: number): NewAudioBookmark => ({
  request: { book: 'pride-and-prejudice', kind: 'voice', position: { chapter: 'chapter-6', page }, offset },
  view: { kind: 'voice', opening: '', place: place(page, offset) },
  label: `Ch. 6 · p. ${page}`,
})

function later<T>() {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function setup(answer: AudioLoadAnswer = { state: 'ready', bookmarks: [] }, over: Partial<AudioDeps> = {}) {
  const toasts: string[] = []
  const deps: AudioDeps = {
    load: vi.fn(async () => answer),
    create: vi.fn(async () => ({ ok: true as const, value: { bookmark: saved(9, 2, 50), created: true } })),
    remove: vi.fn(async () => ({ ok: true as const, value: true as const })),
    toast: (text) => toasts.push(text),
    ...over,
  }
  const list = new AudioBookmarkList('pride-and-prejudice', deps, 'loading')
  const changes = vi.fn()
  list.subscribe(changes)
  return { list, deps, toasts, changes, snap: () => list.getSnapshot() }
}

const ids = (items: readonly AudioBookmarkView[]) => items.map((b) => b.id)

describe('AudioBookmarkList, loading', () => {
  it('loads the book’s audio bookmarks in listening order for a signed-in reader', async () => {
    const { list, deps, snap, changes } = setup({ state: 'ready', bookmarks: [saved(2, 3), saved(1, 2, 90)] })
    list.start({ signedIn: true })
    expect(snap().state).toBe('loading')
    await list.load()
    expect(deps.load).toHaveBeenCalledWith('pride-and-prejudice')
    expect(snap().state).toBe('ready')
    expect(ids(snap().items)).toEqual([ID(1), ID(2)])
    expect(changes).toHaveBeenCalled()
  })

  it('is signed out without a reader, and loads nothing', () => {
    const { list, deps, snap } = setup()
    list.start({ signedIn: false })
    expect(snap().state).toBe('signed_out')
    expect(deps.load).not.toHaveBeenCalled()
  })

  it('says signed out or unavailable when the server does or the load throws; Retry loads again', async () => {
    const signedOut = setup({ state: 'signed_out' })
    await signedOut.list.load()
    expect(signedOut.snap().state).toBe('signed_out')
    const missing = setup({ state: 'not_found' })
    await missing.list.load()
    expect(missing.snap().state).toBe('unavailable')
    const thrown = setup(undefined, {
      load: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    await thrown.list.load()
    expect(thrown.snap().state).toBe('unavailable')
    thrown.list.retry()
    expect(thrown.snap().state).toBe('loading')
    expect(thrown.deps.load).toHaveBeenCalledTimes(2)
  })

  it('ignores a load that answers after the reader signed out', async () => {
    const answer = later<AudioLoadAnswer>()
    const { list, snap } = setup(undefined, { load: vi.fn(() => answer.promise) })
    list.start({ signedIn: true })
    list.start({ signedIn: false })
    answer.settle({ state: 'ready', bookmarks: [saved(1, 2)] })
    await answer.promise
    await Promise.resolve()
    expect(snap()).toEqual({ state: 'signed_out', items: [] })
  })
})

describe('AudioBookmarkList, add', () => {
  it('shows the moment at once, last, says so, and takes the server’s entry when it answers', async () => {
    const answer = later<Awaited<ReturnType<AudioDeps['create']>>>()
    const { list, deps, snap, toasts } = setup(
      { state: 'ready', bookmarks: [saved(1, 4)] },
      {
        create: vi.fn(() => answer.promise),
      },
    )
    await list.load()
    const adding = list.bookmark(moment(2, 50))
    expect(snap().items.map((b) => [b.pending, b.kind])).toEqual([
      [false, 'voice'],
      [true, 'voice'],
    ])
    expect(toasts).toEqual(['Moment bookmarked · Ch. 6 · p. 2'])
    expect(deps.create).toHaveBeenCalledWith(moment(2, 50).request)
    answer.settle({ ok: true, value: { bookmark: saved(9, 2, 50), created: true } })
    await adding
    expect(ids(snap().items)).toEqual([ID(9), ID(1)])
    expect(snap().items[0]?.pending).toBe(false)
  })

  it('keeps one entry when the moment was bookmarked already', async () => {
    const { list, snap } = setup(
      { state: 'ready', bookmarks: [saved(9, 2, 50)] },
      {
        create: vi.fn(async () => ({ ok: true as const, value: { bookmark: saved(9, 2, 50), created: false } })),
      },
    )
    await list.load()
    await list.bookmark(moment(2, 50))
    expect(ids(snap().items)).toEqual([ID(9)])
  })

  it('removes a refused moment and says why', async () => {
    for (const problem of ['quota-book', 'quota-user', 'failed', 'signed_out'] as BookmarkProblem[]) {
      const { list, snap, toasts } = setup(undefined, {
        create: vi.fn(async () => ({ ok: false as const, problem })),
      })
      await list.load()
      await list.bookmark(moment(2, 50))
      expect(snap().items, problem).toEqual([])
      expect(toasts.at(-1), problem).toBe(AUDIO_PROBLEM_TEXT[problem])
      if (problem === 'signed_out') expect(snap().state).toBe('signed_out')
    }
    expect(AUDIO_PROBLEM_TEXT['quota-book']).toBe('You’ve reached 1,000 audio bookmarks in this book.')
  })

  it('says a create’s not_found as a failure to save, since it is the book that wasn’t found', async () => {
    const { list, toasts } = setup(undefined, {
      create: vi.fn(async () => ({ ok: false as const, problem: 'not_found' as const })),
    })
    await list.load()
    await list.bookmark(moment(2, 50))
    expect(toasts.at(-1)).toBe(AUDIO_PROBLEM_TEXT.failed)
  })

  it('works while the list loads, and keeps the moment when the load answers without it', async () => {
    const loaded = later<AudioLoadAnswer>()
    const { list, snap } = setup(undefined, { load: vi.fn(() => loaded.promise) })
    list.start({ signedIn: true })
    await list.bookmark(moment(2, 50))
    expect(ids(snap().items)).toEqual([ID(9)])
    loaded.settle({ state: 'ready', bookmarks: [saved(1, 4)] })
    await loaded.promise
    await Promise.resolve()
    expect(snap().state).toBe('ready')
    expect(ids(snap().items)).toEqual([ID(9), ID(1)])
  })

  it('does nothing signed out', async () => {
    const { list, deps, snap, toasts } = setup()
    list.start({ signedIn: false })
    await list.bookmark(moment(2, 50))
    expect(deps.create).not.toHaveBeenCalled()
    expect(snap().items).toEqual([])
    expect(toasts).toEqual([])
  })
})

describe('AudioBookmarkList, remove', () => {
  it('removes at once and says so', async () => {
    const { list, deps, snap, toasts } = setup({ state: 'ready', bookmarks: [saved(1, 2)] })
    await list.load()
    await list.remove(ID(1))
    expect(snap().items).toEqual([])
    expect(toasts).toEqual(['Bookmark removed'])
    expect(deps.remove).toHaveBeenCalledWith(ID(1))
  })

  it('waits for a moment still being saved to get its id', async () => {
    const created = later<Awaited<ReturnType<AudioDeps['create']>>>()
    const { list, deps, snap } = setup(undefined, { create: vi.fn(() => created.promise) })
    await list.load()
    const adding = list.bookmark(moment(2, 50))
    const key = snap().items[0]?.key as string
    const removing = list.remove(key)
    expect(snap().items).toEqual([])
    expect(deps.remove).not.toHaveBeenCalled()
    created.settle({ ok: true, value: { bookmark: saved(9, 2, 50), created: true } })
    await adding
    await removing
    expect(deps.remove).toHaveBeenCalledWith(ID(9))
  })

  it('puts a refused remove back, but not one already removed', async () => {
    const { list, snap, toasts } = setup(
      { state: 'ready', bookmarks: [saved(1, 2)] },
      {
        remove: vi.fn(async () => ({ ok: false as const, problem: 'failed' as const })),
      },
    )
    await list.load()
    await list.remove(ID(1))
    expect(ids(snap().items)).toEqual([ID(1)])
    expect(toasts.at(-1)).toBe(AUDIO_PROBLEM_TEXT.failed)

    const gone = setup(
      { state: 'ready', bookmarks: [saved(1, 2)] },
      {
        remove: vi.fn(async () => ({ ok: false as const, problem: 'not_found' as const })),
      },
    )
    await gone.list.load()
    await gone.list.remove(ID(1))
    expect(gone.snap().items).toEqual([])
    expect(gone.toasts.at(-1)).toBe('That bookmark was already removed.')
  })

  it('ignores an unknown key', async () => {
    const { list, deps } = setup()
    await list.load()
    await list.remove('nope')
    expect(deps.remove).not.toHaveBeenCalled()
  })
})

describe('AudioBookmarkRegistry', () => {
  function registry() {
    const deps: AudioDeps = {
      load: vi.fn(async (book: string) => ({ state: 'ready' as const, bookmarks: book === 'a' ? [saved(1, 2)] : [] })),
      create: vi.fn(async () => ({ ok: true as const, value: { bookmark: saved(9, 2, 50), created: true } })),
      remove: vi.fn(async () => ({ ok: true as const, value: true as const })),
      toast: () => {},
    }
    return { deps, lists: new AudioBookmarkRegistry(deps) }
  }

  it('gives every component the same list for a book, and another for another book', () => {
    const { lists } = registry()
    expect(lists.listFor('a', true)).toBe(lists.listFor('a', true))
    expect(lists.listFor('b', true)).not.toBe(lists.listFor('a', true))
    expect(lists.listFor('c', false).getSnapshot().state).toBe('signed_out')
  })

  it('starts a book’s list once per sign-in, however many components show it', async () => {
    const { deps, lists } = registry()
    lists.sync('a', true)
    lists.sync('a', true)
    await Promise.resolve()
    expect(deps.load).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(lists.listFor('a', true).getSnapshot().state).toBe('ready'))
  })

  it('empties every list on sign-out, and loads again on the next sign-in', async () => {
    const { deps, lists } = registry()
    lists.sync('a', true)
    lists.sync('b', true)
    await vi.waitFor(() => expect(lists.listFor('a', true).getSnapshot().items).toHaveLength(1))
    lists.sync('b', false)
    expect(lists.listFor('a', false).getSnapshot()).toEqual({ state: 'signed_out', items: [] })
    expect(lists.listFor('b', false).getSnapshot()).toEqual({ state: 'signed_out', items: [] })
    lists.sync('a', true)
    await vi.waitFor(() => expect(lists.listFor('a', true).getSnapshot().state).toBe('ready'))
    expect(deps.load).toHaveBeenCalledTimes(3)
  })
})
