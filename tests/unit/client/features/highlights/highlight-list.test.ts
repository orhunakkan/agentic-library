import { describe, expect, it, vi } from 'vitest'
import {
  type HighlightDeps,
  HighlightList,
  type HighlightLoadAnswer,
  type NewHighlight,
  PROBLEM_TEXT,
} from '~/client/features/highlights/highlight-list'
import type { HighlightProblem } from '~/client/features/highlights/highlights-client'
import * as client from '~/client/features/highlights/highlights-client'
import type { HighlightView } from '~/shared/highlights/group'

const ID = (n: number) => `6f1c0000-0000-4000-8000-00000000000${n}`

function place(page: number, start: number) {
  return {
    chapterIndex: 5,
    chapterTitle: '6. Chapter 6',
    chapter: 'chapter-6',
    page,
    pageHref: `/read/pride-and-prejudice/chapter-6/${page}`,
    label: `Ch. 6 · p. ${page}`,
    position: 40 + page,
    start,
    end: start + 20,
  }
}

const saved = (n: number, page: number, over: Partial<HighlightView> = {}): HighlightView => ({
  id: ID(n),
  color: 'yellow',
  note: null,
  text: `Passage ${n}`,
  status: 'ok',
  place: { ...place(page, 10), href: place(page, 10).pageHref },
  createdAt: `2026-11-05T10:0${n}:00.000Z`,
  updatedAt: `2026-11-05T10:0${n}:00.000Z`,
  ...over,
})

const passageOn = (page: number): NewHighlight => ({
  position: { chapter: 'chapter-6', page },
  start: 10,
  end: 30,
  text: 'It is a truth universally acknowledged',
  place: place(page, 10),
})

function later<T>() {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

type Created = Awaited<ReturnType<HighlightDeps['create']>>

function setup(answer: HighlightLoadAnswer = { state: 'ready', highlights: [] }, over: Partial<HighlightDeps> = {}) {
  const toasts: string[] = []
  const deps: HighlightDeps = {
    load: vi.fn(async () => answer),
    create: vi.fn(async (): Promise<Created> => ({ ok: true, value: saved(9, 2) })),
    update: vi.fn(async (id, change) => ({ ok: true as const, value: { ...saved(9, 2), id, ...change } })),
    remove: vi.fn(async () => ({ ok: true as const, value: true as const })),
    toast: (text) => toasts.push(text),
    ...over,
  }
  const list = new HighlightList('pride-and-prejudice', deps, 'loading')
  const changes = vi.fn()
  list.subscribe(changes)
  return { list, deps, toasts, changes, snap: () => list.getSnapshot() }
}

describe('HighlightList, loading', () => {
  it('loads the book’s highlights for a signed-in reader, and tells its subscribers', async () => {
    const { list, deps, snap, changes } = setup({ state: 'ready', highlights: [saved(1, 2)] })
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

  it('says unavailable when the load fails; Retry loads again', async () => {
    const { list, deps, snap } = setup(undefined, { load: vi.fn(async () => Promise.reject(new Error('offline'))) })
    await list.load()
    expect(snap().state).toBe('unavailable')
    list.retry()
    expect(snap().state).toBe('loading')
    expect(deps.load).toHaveBeenCalledTimes(2)
  })

  it('keeps a highlight whose save finished while a reload was on its way', async () => {
    const reload = later<HighlightLoadAnswer>()
    const load = vi.fn(async (): Promise<HighlightLoadAnswer> => ({ state: 'ready', highlights: [saved(1, 4)] }))
    const { list, snap } = setup(undefined, { load })
    await list.load()
    load.mockReturnValueOnce(reload.promise)
    const reloading = list.load()
    list.create(passageOn(2))
    await vi.waitFor(() => expect(snap().items.every((h) => !h.pending)).toBe(true))
    reload.settle({ state: 'ready', highlights: [saved(1, 4)] })
    await reloading
    expect(snap().items.map((h) => [h.key, h.id])).toEqual([
      [ID(1), ID(1)],
      ['new-1', ID(9)],
    ])
  })
})

describe('HighlightList, changes', () => {
  it('shows a new highlight at once in the current color, and returns its key', async () => {
    const answer = later<Created>()
    const { list, deps, snap } = setup(undefined, { create: vi.fn(() => answer.promise) })
    await list.load()
    const key = list.create(passageOn(2))
    expect(key).toBe('new-1')
    expect(snap().items).toMatchObject([{ key, pending: true, color: 'yellow', note: null }])
    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({ book: 'pride-and-prejudice', color: 'yellow' }))
    answer.settle({ ok: true, value: saved(9, 2) })
    await vi.waitFor(() => expect(snap().items).toMatchObject([{ key, id: ID(9), pending: false }]))
  })

  it('keeps one entry when a reload already brought in the same highlight', async () => {
    const answer = later<Created>()
    const load = vi.fn(async (): Promise<HighlightLoadAnswer> => ({ state: 'ready', highlights: [] }))
    const { list, snap } = setup(undefined, { load, create: () => answer.promise })
    await list.load()
    list.create(passageOn(2))
    load.mockResolvedValueOnce({ state: 'ready', highlights: [saved(9, 2)] })
    await list.load()
    answer.settle({ ok: true, value: saved(9, 2) })
    await vi.waitFor(() => expect(snap().items.map((h) => [h.key, h.id])).toEqual([['new-1', ID(9)]]))
  })

  it('recolors at once, remembers the color for the next highlight, and keeps it when the create answers later', async () => {
    const answer = later<Created>()
    const { list, deps, snap } = setup(undefined, { create: () => answer.promise })
    await list.load()
    const key = list.create(passageOn(2))
    list.recolor(key, 'blue')
    expect(snap().color).toBe('blue')
    expect(snap().items[0]?.color).toBe('blue')
    answer.settle({ ok: true, value: saved(9, 2) })
    await vi.waitFor(() => expect(deps.update).toHaveBeenCalledWith(ID(9), { color: 'blue' }))
    await vi.waitFor(() => expect(snap().items).toMatchObject([{ key, id: ID(9), color: 'blue' }]))
  })

  it('saves a trimmed note and says so; an empty note clears it', async () => {
    const { list, deps, toasts } = setup({ state: 'ready', highlights: [saved(1, 2)] })
    await list.load()
    expect(await list.saveNote(ID(1), '  Mr Darcy  ')).toBe(true)
    expect(deps.update).toHaveBeenCalledWith(ID(1), { note: 'Mr Darcy' })
    expect(toasts).toEqual(['Note saved'])
    await list.saveNote(ID(1), '   ')
    expect(deps.update).toHaveBeenLastCalledWith(ID(1), { note: null })
  })

  it('deletes at once and says so; puts back one the server couldn’t delete', async () => {
    const refused = vi.fn(async () => ({ ok: false as const, problem: 'failed' as HighlightProblem }))
    const { list, snap, toasts } = setup({ state: 'ready', highlights: [saved(1, 2)] }, { remove: refused })
    await list.load()
    const removing = list.remove(ID(1))
    expect(snap().items).toEqual([])
    await removing
    expect(snap().items.map((h) => h.id)).toEqual([ID(1)])
    expect(toasts).toEqual(['Highlight deleted', PROBLEM_TEXT.failed])
  })

  it('undoes a refused create and says why; signed out turns the list off', async () => {
    const { list, snap, toasts } = setup(undefined, {
      create: vi.fn(async (): Promise<Created> => ({ ok: false, problem: 'signed_out' })),
    })
    await list.load()
    list.create(passageOn(2))
    await vi.waitFor(() => expect(snap()).toMatchObject({ state: 'signed_out', items: [] }))
    expect(toasts).toEqual([PROBLEM_TEXT.signed_out])
  })
})

describe('HighlightList, over the network', () => {
  it('creates, recolors and deletes through the highlights endpoints', async () => {
    const answers = [
      { status: 201, body: { highlight: saved(9, 2) } },
      { status: 200, body: { highlight: saved(9, 2, { color: 'blue' }) } },
      { status: 404, body: { error: 'not_found' } },
    ]
    const fetch = vi.fn(async () => {
      const next = answers.shift()
      return new Response(JSON.stringify(next?.body), { status: next?.status })
    })
    vi.stubGlobal('fetch', fetch)
    const toasts: string[] = []
    const list = new HighlightList(
      'pride-and-prejudice',
      {
        load: async () => ({ state: 'ready', highlights: [] }),
        create: client.createHighlight,
        update: client.updateHighlight,
        remove: client.deleteHighlight,
        toast: (text) => toasts.push(text),
      },
      'loading',
    )
    await list.load()
    const key = list.create(passageOn(2))
    list.recolor(key, 'blue')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(list.getSnapshot().items).toMatchObject([{ key, id: ID(9), color: 'blue' }]))
    await list.remove(key)
    const sent = fetch.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(sent).toEqual(['/account/highlights/new', `/account/highlights/${ID(9)}`, `/account/highlights/${ID(9)}`])
    expect(list.getSnapshot().items).toEqual([])
    expect(toasts).toEqual(['Highlight deleted', PROBLEM_TEXT.not_found])
  })
})
