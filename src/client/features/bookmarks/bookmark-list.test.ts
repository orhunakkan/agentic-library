import { describe, expect, it, vi } from 'vitest'
import type { BookmarkView } from '~/shared/bookmarks/bookmarks'
import { BookmarkList, type Deps, type LoadAnswer, type NewBookmark, PROBLEM_TEXT } from './bookmark-list'
import type { BookmarkProblem } from './bookmarks-client'

const ID = (n: number) => `6f1c0000-0000-4000-8000-00000000000${n}`

function place(page: number) {
  return {
    chapterIndex: 5,
    chapterTitle: '6. Chapter 6',
    chapter: 'chapter-6',
    page,
    pageHref: `/read/pride-and-prejudice/chapter-6/${page}`,
    label: `Ch. 6 · p. ${page}`,
    position: 40 + page,
  }
}

const saved = (n: number, page: number): BookmarkView => ({
  id: ID(n),
  status: 'ok',
  opening: `Page ${page} opens`,
  place: place(page),
  createdAt: `2026-11-05T10:0${n}:00.000Z`,
})

const newOn = (page: number): NewBookmark => ({ position: { chapter: 'chapter-6', page }, place: place(page) })

function later<T>() {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function setup(answer: LoadAnswer = { state: 'ready', bookmarks: [] }, over: Partial<Deps> = {}) {
  const toasts: string[] = []
  const deps: Deps = {
    load: vi.fn(async () => answer),
    create: vi.fn(async () => ({ ok: true as const, value: { bookmark: saved(9, 2), created: true } })),
    remove: vi.fn(async () => ({ ok: true as const, value: true as const })),
    toast: (text) => toasts.push(text),
    ...over,
  }
  const list = new BookmarkList('pride-and-prejudice', deps, 'loading')
  const changes = vi.fn()
  list.subscribe(changes)
  return { list, deps, toasts, changes, snap: () => list.getSnapshot() }
}

describe('BookmarkList, loading', () => {
  it('loads the book’s bookmarks for a signed-in reader, and tells its subscribers', async () => {
    const { list, deps, snap, changes } = setup({ state: 'ready', bookmarks: [saved(1, 2)] })
    list.start({ signedIn: true, embedded: false })
    expect(snap().state).toBe('loading')
    await list.load()
    expect(deps.load).toHaveBeenCalledWith('pride-and-prejudice')
    expect(snap()).toMatchObject({ state: 'ready', items: [{ id: ID(1), key: ID(1), pending: false }] })
    expect(changes).toHaveBeenCalled()
  })

  it('is off when embedded and signed out without a reader, and loads nothing', () => {
    const { list, deps, snap } = setup()
    list.start({ signedIn: true, embedded: true })
    expect(snap().state).toBe('off')
    list.start({ signedIn: false, embedded: false })
    expect(snap().state).toBe('signed_out')
    expect(deps.load).not.toHaveBeenCalled()
  })

  it('says signed out or unavailable when the server does, or when the load throws; Retry loads again', async () => {
    const signedOut = setup({ state: 'signed_out' })
    await signedOut.list.load()
    expect(signedOut.snap().state).toBe('signed_out')
    const missing = setup({ state: 'not_found' })
    await missing.list.load()
    expect(missing.snap().state).toBe('unavailable')
    const broken = setup(undefined, { load: vi.fn(async () => Promise.reject(new Error('offline'))) })
    await broken.list.load()
    expect(broken.snap().state).toBe('unavailable')
    broken.list.retry()
    expect(broken.snap().state).toBe('loading')
    expect(broken.deps.load).toHaveBeenCalledTimes(2)
  })

  it('ignores a load that answers after the reader signed out', async () => {
    const answer = later<LoadAnswer>()
    const { list, snap } = setup(undefined, { load: () => answer.promise })
    list.start({ signedIn: true, embedded: false })
    list.start({ signedIn: false, embedded: false })
    answer.settle({ state: 'ready', bookmarks: [saved(1, 2)] })
    await answer.promise
    await Promise.resolve()
    expect(snap()).toEqual({ state: 'signed_out', items: [] })
  })
})

describe('BookmarkList, the ribbon', () => {
  it('does nothing until the list has loaded', async () => {
    const { list, deps, toasts } = setup()
    await list.toggle(newOn(2))
    expect(deps.create).not.toHaveBeenCalled()
    expect(toasts).toEqual([])
  })

  it('bookmarks the page at once, and swaps in the server’s bookmark under the same key', async () => {
    const answer = later<Awaited<ReturnType<Deps['create']>>>()
    const { list, deps, snap, toasts } = setup(undefined, { create: () => answer.promise })
    await list.load()
    const done = list.toggle(newOn(2))
    expect(snap().items).toMatchObject([{ key: 'new-1', pending: true, opening: '', place: place(2) }])
    expect(toasts).toEqual(['Page bookmarked'])
    answer.settle({ ok: true, value: { bookmark: saved(9, 2), created: true } })
    await done
    expect(snap().items).toMatchObject([{ key: 'new-1', id: ID(9), pending: false, opening: 'Page 2 opens' }])
    expect(deps.remove).not.toHaveBeenCalled()
  })

  it('keeps one entry when a reload brought in the same page’s bookmark while this one was saving', async () => {
    const answer = later<Awaited<ReturnType<Deps['create']>>>()
    const load = vi.fn(async (): Promise<LoadAnswer> => ({ state: 'ready', bookmarks: [] }))
    const { list, snap } = setup(undefined, { load, create: () => answer.promise })
    await list.load()
    const creating = list.toggle(newOn(2))
    load.mockResolvedValueOnce({ state: 'ready', bookmarks: [saved(9, 2)] })
    await list.load()
    expect(snap().items.map((b) => b.key)).toEqual([ID(9), 'new-1'])
    answer.settle({ ok: true, value: { bookmark: saved(9, 2), created: false } })
    await creating
    expect(snap().items.map((b) => [b.key, b.id])).toEqual([['new-1', ID(9)]])
  })

  it('removes every bookmark on the page, once', async () => {
    const { list, deps, snap, toasts } = setup({
      state: 'ready',
      bookmarks: [saved(1, 2), { ...saved(2, 2), status: 'moved' }, saved(3, 4)],
    })
    await list.load()
    await list.toggle(newOn(2))
    expect(deps.remove).toHaveBeenCalledTimes(2)
    expect(deps.remove).toHaveBeenCalledWith(ID(1))
    expect(deps.remove).toHaveBeenCalledWith(ID(2))
    expect(snap().items.map((b) => b.id)).toEqual([ID(3)])
    expect(toasts).toEqual(['Bookmark removed'])
  })

  it('waits for a new bookmark’s id before removing it', async () => {
    const answer = later<Awaited<ReturnType<Deps['create']>>>()
    const { list, deps, snap } = setup(undefined, { create: () => answer.promise })
    await list.load()
    const creating = list.toggle(newOn(2))
    const removing = list.toggle(newOn(2))
    expect(snap().items).toEqual([])
    expect(deps.remove).not.toHaveBeenCalled()
    answer.settle({ ok: true, value: { bookmark: saved(9, 2), created: true } })
    await Promise.all([creating, removing])
    expect(deps.remove).toHaveBeenCalledWith(ID(9))
  })
})

describe('BookmarkList, refusals', () => {
  const refused = (problem: BookmarkProblem) => vi.fn(async () => ({ ok: false as const, problem }))

  it('undoes a refused create and says why; signed out turns the list off', async () => {
    for (const problem of ['quota-book', 'quota-user', 'failed'] as const) {
      const { list, snap, toasts } = setup(undefined, { create: refused(problem) })
      await list.load()
      await list.toggle(newOn(2))
      expect(snap()).toEqual({ state: 'ready', items: [] })
      expect(toasts).toEqual(['Page bookmarked', PROBLEM_TEXT[problem]])
    }
    const { list, snap, toasts } = setup(undefined, { create: refused('signed_out') })
    await list.load()
    await list.toggle(newOn(2))
    expect(snap().state).toBe('signed_out')
    expect(toasts.at(-1)).toBe('You’ve been signed out. Sign in to keep bookmarks.')
  })

  it('never sends a delete for a bookmark whose create was refused', async () => {
    const answer = later<Awaited<ReturnType<Deps['create']>>>()
    const { list, deps } = setup(undefined, { create: () => answer.promise })
    await list.load()
    const creating = list.toggle(newOn(2))
    const removing = list.toggle(newOn(2))
    answer.settle({ ok: false, problem: 'failed' })
    await Promise.all([creating, removing])
    expect(deps.remove).not.toHaveBeenCalled()
  })

  it('puts back a bookmark the server couldn’t remove, but not one already gone', async () => {
    const failing = setup({ state: 'ready', bookmarks: [saved(1, 2)] }, { remove: refused('failed') })
    await failing.list.load()
    await failing.list.remove(ID(1))
    expect(failing.snap().items.map((b) => b.id)).toEqual([ID(1)])
    expect(failing.toasts).toEqual(['Bookmark removed', 'Couldn’t save that. Try again.'])

    const gone = setup({ state: 'ready', bookmarks: [saved(1, 2)] }, { remove: refused('not_found') })
    await gone.list.load()
    await gone.list.remove(ID(1))
    expect(gone.snap().items).toEqual([])
    expect(gone.toasts.at(-1)).toBe('That bookmark was already removed.')
    await gone.list.remove('nothing')
    expect(gone.deps.remove).toHaveBeenCalledTimes(1)
  })

  it('keeps a bookmark still being saved across a reload', async () => {
    const answer = later<Awaited<ReturnType<Deps['create']>>>()
    const { list, snap } = setup({ state: 'ready', bookmarks: [saved(1, 4)] }, { create: () => answer.promise })
    await list.load()
    const creating = list.toggle(newOn(2))
    await list.load()
    expect(snap().items.map((b) => b.key)).toEqual([ID(1), 'new-1'])
    answer.settle({ ok: true, value: { bookmark: saved(9, 2), created: true } })
    await creating
  })
})
