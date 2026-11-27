import { describe, expect, it, vi } from 'vitest'
import type { PromptResult } from '~/client/features/ask-prompts/ask-prompts-client'
import { moved, type PromptRequests, PromptStore } from '~/client/features/ask-prompts/prompt-store'
import type { AskPromptView } from '~/shared/ask-prompts/prompts'

const prompt = (id: string): AskPromptView => ({ id, name: id.toUpperCase(), appliesTo: 'pages', instruction: 'x' })
const A = prompt('a')
const B = prompt('b')
const C = prompt('c')
const FIELDS = { name: 'D', appliesTo: 'pages', instruction: 'x' }

const ok = <T>(value: T): PromptResult<T> => ({ ok: true, value })
const refused = (problem: 'not_found' | 'failed' | 'exists'): PromptResult<never> => ({ ok: false, problem })

function storeWith(requests: Partial<PromptRequests>, initial = [A, B, C]) {
  const all: PromptRequests = {
    createPrompt: vi.fn(),
    editPrompt: vi.fn(),
    movePrompt: vi.fn(),
    deletePrompt: vi.fn(),
    ...requests,
  }
  const store = new PromptStore(all, initial)
  const ids = () => store.getSnapshot().map((p) => p.id)
  return { store, ids }
}

function deferred<T>() {
  let answer: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    answer = resolve
  })
  return { promise, answer }
}

describe('moved', () => {
  it('swaps with the neighbour, and leaves the list at either end or for an unknown id', () => {
    const ids = (list: readonly AskPromptView[]) => list.map((p) => p.id)
    expect(ids(moved([A, B, C], 'c', 'up'))).toEqual(['a', 'c', 'b'])
    expect(ids(moved([A, B, C], 'a', 'down'))).toEqual(['b', 'a', 'c'])
    const list = [A, B, C]
    expect(moved(list, 'a', 'up')).toBe(list)
    expect(moved(list, 'c', 'down')).toBe(list)
    expect(moved(list, 'z', 'up')).toBe(list)
  })
})

describe('PromptStore', () => {
  it('adds a saved prompt last, and only once the server has it', async () => {
    const D = prompt('d')
    const { store, ids } = storeWith({
      createPrompt: vi.fn().mockResolvedValueOnce(refused('exists')).mockResolvedValueOnce(ok(D)),
    })
    expect(await store.create(FIELDS)).toEqual(refused('exists'))
    expect(ids()).toEqual(['a', 'b', 'c'])
    await store.create(FIELDS)
    expect(ids()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('replaces an edited prompt, and drops one the server no longer has', async () => {
    const edited = { ...B, name: 'Bee' }
    const { store, ids } = storeWith({
      editPrompt: vi.fn().mockResolvedValueOnce(ok(edited)).mockResolvedValueOnce(refused('not_found')),
    })
    await store.edit('b', FIELDS)
    expect(store.getSnapshot()[1]).toEqual(edited)
    await store.edit('c', FIELDS)
    expect(ids()).toEqual(['a', 'b'])
  })

  it('keeps an edit the server refused for another reason', async () => {
    const { store, ids } = storeWith({ editPrompt: vi.fn().mockResolvedValue(refused('failed')) })
    await store.edit('b', FIELDS)
    expect(ids()).toEqual(['a', 'b', 'c'])
  })

  it('moves at once, then takes the server’s order', async () => {
    const answer = deferred<PromptResult<AskPromptView[]>>()
    const { store, ids } = storeWith({ movePrompt: vi.fn(() => answer.promise) })
    const done = store.move('c', 'up')
    expect(ids()).toEqual(['a', 'c', 'b'])
    answer.answer(ok([C, A, B]))
    await done
    expect(ids()).toEqual(['c', 'a', 'b'])
  })

  it('undoes a refused move, and drops a prompt that has gone', async () => {
    const { store, ids } = storeWith({
      movePrompt: vi.fn().mockResolvedValueOnce(refused('failed')).mockResolvedValueOnce(refused('not_found')),
    })
    await store.move('c', 'up')
    expect(ids()).toEqual(['a', 'b', 'c'])
    await store.move('b', 'down')
    expect(ids()).toEqual(['a', 'c'])
  })

  it('deletes at once, keeps it gone when it already was, and puts it back when refused', async () => {
    const answer = deferred<PromptResult<true>>()
    const { store, ids } = storeWith({
      deletePrompt: vi
        .fn()
        .mockImplementationOnce(() => answer.promise)
        .mockResolvedValueOnce(refused('not_found'))
        .mockResolvedValueOnce(refused('failed')),
    })
    const done = store.remove('a')
    expect(ids()).toEqual(['b', 'c'])
    answer.answer(ok(true))
    await done
    expect(ids()).toEqual(['b', 'c'])
    await store.remove('b')
    expect(ids()).toEqual(['c'])
    await store.remove('c')
    expect(ids()).toEqual(['c'])
  })

  it('tells its listeners of each change until they unsubscribe', async () => {
    const { store } = storeWith({ deletePrompt: vi.fn().mockResolvedValue(ok(true)) })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    await store.remove('a')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    await store.remove('b')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
