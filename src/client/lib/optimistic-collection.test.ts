import { describe, expect, it, vi } from 'vitest'
import {
  type CollectionLoadAnswer,
  type CollectionRules,
  itemsUnder,
  OptimisticCollection,
  reloadWhenBack,
} from './optimistic-collection'
import type { ChangeResult } from './post'

interface Note {
  id: string
  text: string
}

type Problem = 'signed_out' | 'not_found' | 'failed'

const ID = (n: number) => `6f1c0000-0000-4000-8000-00000000000${n}`

function later<T>() {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function setup(over: Partial<CollectionRules<Note, string, Problem>> = {}) {
  const refusals: Problem[] = []
  const rules: CollectionRules<Note, string, Problem> = {
    load: vi.fn(async (): Promise<CollectionLoadAnswer<Note>> => ({ state: 'ready', items: [] })),
    create: vi.fn(
      async (text: string): Promise<ChangeResult<Note, Problem>> => ({ ok: true, value: { id: ID(9), text } }),
    ),
    update: vi.fn(
      async (id: string, patch: Partial<Note>): Promise<ChangeResult<Note, Problem>> => ({
        ok: true,
        value: { id, text: patch.text ?? '' },
      }),
    ),
    remove: vi.fn(async (): Promise<ChangeResult<true, Problem>> => ({ ok: true, value: true })),
    draft: (text, key) => ({ id: key, text }),
    refused: (problem) => refusals.push(problem),
    ...over,
  }
  const list = new OptimisticCollection(rules, 'loading')
  return { list, rules, refusals, shown: () => list.getSnapshot().items.map((n) => [n.key, n.id, n.text]) }
}

describe('OptimisticCollection, reloads', () => {
  it('keeps an item whose create finished while a reload was on its way, under the key it was shown by', async () => {
    const first = later<CollectionLoadAnswer<Note>>()
    const second = later<CollectionLoadAnswer<Note>>()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { list, shown } = setup({ load })
    const missing = list.load()
    await list.add('Darcy').saved
    first.settle({ state: 'ready', items: [{ id: ID(1), text: 'Bingley' }] })
    await missing
    expect(shown()).toEqual([
      [ID(1), ID(1), 'Bingley'],
      ['new-1', ID(9), 'Darcy'],
    ])

    const including = list.load()
    second.settle({
      state: 'ready',
      items: [
        { id: ID(1), text: 'Bingley' },
        { id: ID(9), text: 'Darcy' },
      ],
    })
    await including
    expect(shown()).toEqual([
      [ID(1), ID(1), 'Bingley'],
      ['new-1', ID(9), 'Darcy'],
    ])
  })

  it('leaves out an item removed while a late reload was on its way, though the reload still lists it', async () => {
    const late = later<CollectionLoadAnswer<Note>>()
    const load = vi
      .fn()
      .mockResolvedValueOnce({ state: 'ready', items: [{ id: ID(1), text: 'Bingley' }] })
      .mockReturnValueOnce(late.promise)
    const { list, shown } = setup({ load })
    await list.load()
    const reloading = list.load()
    await list.remove(ID(1))
    late.settle({ state: 'ready', items: [{ id: ID(1), text: 'Bingley' }] })
    await reloading
    expect(shown()).toEqual([])
  })

  it('applies a reload sent after a remove answered as usual', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ state: 'ready', items: [{ id: ID(1), text: 'Bingley' }] })
      .mockResolvedValueOnce({ state: 'ready', items: [{ id: ID(1), text: 'Bingley' }] })
    const { list, shown } = setup({ load })
    await list.load()
    await list.remove(ID(1))
    await list.load()
    expect(shown()).toEqual([[ID(1), ID(1), 'Bingley']])
  })

  it('keeps an update answered before a late reload that carries the old value', async () => {
    const late = later<CollectionLoadAnswer<Note>>()
    const old = { state: 'ready' as const, items: [{ id: ID(1), text: 'Bingley' }] }
    const load = vi.fn().mockResolvedValueOnce(old).mockReturnValueOnce(late.promise).mockResolvedValueOnce(old)
    const { list, shown } = setup({ load })
    await list.load()
    const reloading = list.load()
    expect(await list.update(ID(1), { text: 'Jane' })).toBe(true)
    late.settle(old)
    await reloading
    expect(shown()).toEqual([[ID(1), ID(1), 'Jane']])

    await list.load()
    expect(shown()).toEqual([[ID(1), ID(1), 'Bingley']])
  })

  it('keeps an update still on its way when a reload answers with the old value', async () => {
    const updated = later<ChangeResult<Note, Problem>>()
    const old = { state: 'ready' as const, items: [{ id: ID(1), text: 'Bingley' }] }
    const { list, shown } = setup({ load: async () => old, update: () => updated.promise })
    await list.load()
    const updating = list.update(ID(1), { text: 'Jane' })
    await list.load()
    expect(shown()).toEqual([[ID(1), ID(1), 'Jane']])
    updated.settle({ ok: true, value: { id: ID(1), text: 'Jane' } })
    expect(await updating).toBe(true)
    expect(shown()).toEqual([[ID(1), ID(1), 'Jane']])
  })

  it('ignores an older reload that answers after a newer one', async () => {
    const older = later<CollectionLoadAnswer<Note>>()
    const newer = later<CollectionLoadAnswer<Note>>()
    const load = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const { list, shown } = setup({ load })
    const first = list.load()
    const second = list.load()
    newer.settle({ state: 'ready', items: [{ id: ID(2), text: 'Jane' }] })
    await second
    older.settle({ state: 'ready', items: [{ id: ID(1), text: 'Bingley' }] })
    await first
    expect(shown()).toEqual([[ID(2), ID(2), 'Jane']])
  })

  it('forgets what it made when the reader signs in again', async () => {
    const load = vi.fn(async (): Promise<CollectionLoadAnswer<Note>> => ({ state: 'ready', items: [] }))
    const { list, shown } = setup({ load })
    await list.load()
    await list.add('Darcy').saved
    list.start({ signedIn: true })
    await list.load()
    expect(shown()).toEqual([])
  })
})

describe('OptimisticCollection, update', () => {
  it('shows a change at once and sends it once a new item has its id', async () => {
    const created = later<ChangeResult<Note, Problem>>()
    const { list, rules, shown } = setup({
      create: () => created.promise,
      settle: (shownNow, saved) => ({ ...saved, text: shownNow.text }),
    })
    await list.load()
    const { key } = list.add('Darcy')
    const updating = list.update(key, { text: 'Mr Darcy' })
    expect(shown()).toEqual([['new-1', 'new-1', 'Mr Darcy']])
    expect(rules.update).not.toHaveBeenCalled()
    created.settle({ ok: true, value: { id: ID(9), text: 'Darcy' } })
    expect(await updating).toBe(true)
    expect(rules.update).toHaveBeenCalledWith(ID(9), { text: 'Mr Darcy' })
    expect(shown()).toEqual([['new-1', ID(9), 'Mr Darcy']])
  })

  it('puts back what it showed when the server refuses, and drops an item already gone', async () => {
    const answer = { state: 'ready' as const, items: [{ id: ID(1), text: 'Bingley' }] }
    const failing = setup({ load: async () => answer, update: async () => ({ ok: false, problem: 'failed' }) })
    await failing.list.load()
    expect(await failing.list.update(ID(1), { text: 'Jane' })).toBe(false)
    expect(failing.shown()).toEqual([[ID(1), ID(1), 'Bingley']])
    expect(failing.refusals).toEqual(['failed'])

    const gone = setup({ load: async () => answer, update: async () => ({ ok: false, problem: 'not_found' }) })
    await gone.list.load()
    expect(await gone.list.update(ID(1), { text: 'Jane' })).toBe(false)
    expect(gone.shown()).toEqual([])
  })

  it('throws when the list was built without an update rule', async () => {
    const { rules } = setup({ load: async () => ({ state: 'ready', items: [{ id: ID(1), text: 'Bingley' }] }) })
    const { update: _, ...withoutUpdate } = rules
    const bare = new OptimisticCollection(withoutUpdate, 'loading')
    await bare.load()
    await expect(bare.update(ID(1), { text: 'Jane' })).rejects.toThrow('built without an update rule')
    expect(bare.getSnapshot().items.map((n) => n.text)).toEqual(['Bingley'])
  })

  it('signs the list out when the server says the reader signed out', async () => {
    const { list } = setup({ create: async () => ({ ok: false, problem: 'signed_out' }) })
    await list.load()
    await list.add('Darcy').saved
    expect(list.getSnapshot()).toEqual({ state: 'signed_out', items: [] })
  })
})

describe('OptimisticCollection, remove', () => {
  it('takes several items away at once and says so once, and says nothing when none is shown', async () => {
    const removed = vi.fn()
    const answer = {
      state: 'ready' as const,
      items: [
        { id: ID(1), text: 'Bingley' },
        { id: ID(2), text: 'Jane' },
        { id: ID(3), text: 'Darcy' },
      ],
    }
    const { list, rules, shown } = setup({ load: async () => answer, removed })
    await list.load()
    const removing = list.remove([ID(1), ID(2)])
    expect(shown()).toEqual([[ID(3), ID(3), 'Darcy']])
    expect(removed).toHaveBeenCalledTimes(1)
    await removing
    expect(rules.remove).toHaveBeenCalledTimes(2)

    await list.remove(ID(1))
    expect(removed).toHaveBeenCalledTimes(1)
  })
})

describe('OptimisticCollection, extra snapshot fields', () => {
  it('carries a feature’s own fields in the snapshot, and tells listeners when they change', async () => {
    const { rules } = setup()
    const list = new OptimisticCollection(rules, 'loading', { mood: 'calm' })
    const heard = vi.fn()
    list.subscribe(heard)
    expect(list.getSnapshot()).toEqual({ state: 'loading', items: [], mood: 'calm' })
    list.extend({ mood: 'cross' })
    expect(heard).toHaveBeenCalledTimes(1)
    await list.load()
    expect(list.getSnapshot()).toEqual({ state: 'ready', items: [], mood: 'cross' })
  })
})

describe('itemsUnder', () => {
  it('names a feature’s loaded things as the list’s items, and passes other answers through', async () => {
    const notes = [{ id: ID(1), text: 'Bingley' }]
    expect(await itemsUnder('notes', Promise.resolve({ state: 'ready', notes }))).toEqual({
      state: 'ready',
      items: notes,
    })
    expect(await itemsUnder('notes', Promise.resolve({ state: 'signed_out' }))).toEqual({ state: 'signed_out' })
  })
})

describe('reloadWhenBack', () => {
  it('reloads when the reader comes back after a minute away, not sooner, and not without having left', () => {
    let clock = 0
    const reload = vi.fn()
    const onVisibility = reloadWhenBack(reload, 60_000, () => clock)
    onVisibility('visible')
    expect(reload).not.toHaveBeenCalled()
    onVisibility('hidden')
    clock = 59_999
    onVisibility('visible')
    expect(reload).not.toHaveBeenCalled()
    onVisibility('hidden')
    clock += 60_000
    onVisibility('visible')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
