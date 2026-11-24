import type { ChangeResult } from './post'

/** Where a reader-owned list stands: off when embedded, signed out, loading, ready, or failed to load. */
export type CollectionState = 'off' | 'signed_out' | 'loading' | 'ready' | 'unavailable'

/** One saved thing, under the key the list shows it by: its id, or the temporary key it was created under. */
export type Entry<T> = T & { key: string; pending: boolean }

export interface CollectionSnapshot<T> {
  state: CollectionState
  items: Entry<T>[]
}

export type CollectionLoadAnswer<T> =
  | { state: 'ready'; items: T[] }
  | { state: 'signed_out' | 'not_found' | 'unavailable' }

/** What one feature passes in: its endpoints, how it shows a refusal, and its own order and merge rules. */
export interface CollectionRules<T extends { id: string }, Input, P extends string> {
  load: () => Promise<CollectionLoadAnswer<T>>
  create: (input: Input) => Promise<ChangeResult<T, P>>
  update?: (id: string, patch: Partial<T>) => Promise<ChangeResult<T, P>>
  remove: (id: string) => Promise<ChangeResult<true, P>>
  /** What the list shows while a create is on its way; `id` is the temporary key until the server answers. */
  draft: (input: Input, key: string) => T
  /** Says why a change was refused. A `signed_out` refusal also signs the list out. */
  refused: (problem: P) => void
  order?: (items: Entry<T>[]) => Entry<T>[]
  /** What to keep when a create's answer arrives, given what the list shows by then; the server's answer by default. */
  settle?: (shown: Entry<T>, saved: T) => T
}

/**
 * A reader-owned list that shows each change at once and sends it in the background. A create gets a temporary
 * key, and later changes to it wait for its id. A reload keeps creates still on their way, and creates that
 * finished after the reload was sent, so its answer can't drop them.
 */
export class OptimisticCollection<T extends { id: string }, Input, P extends string> {
  private snapshot: CollectionSnapshot<T>
  private readonly listeners = new Set<() => void>()
  private readonly ids = new Map<string, Promise<string | null>>()
  private readonly made = new Map<string, string>()
  private counter = 0
  private generation = 0

  constructor(
    private readonly rules: CollectionRules<T, Input, P>,
    state: CollectionState,
  ) {
    this.snapshot = { state, items: [] }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): CollectionSnapshot<T> => this.snapshot

  get state(): CollectionState {
    return this.snapshot.state
  }

  find(key: string): Entry<T> | undefined {
    return this.snapshot.items.find((item) => item.key === key)
  }

  private set(next: Partial<CollectionSnapshot<T>>) {
    const { order } = this.rules
    const items = next.items ? (order ? order(next.items) : next.items) : this.snapshot.items
    this.snapshot = { ...this.snapshot, ...next, items }
    for (const listener of this.listeners) listener()
  }

  private setItems(change: (items: Entry<T>[]) => Entry<T>[]) {
    this.set({ items: change(this.snapshot.items) })
  }

  private replace(key: string, next: Entry<T> | null) {
    this.setItems((items) =>
      next ? items.map((item) => (item.key === key ? next : item)) : items.filter((item) => item.key !== key),
    )
  }

  start({ signedIn, embedded = false }: { signedIn: boolean; embedded?: boolean }): void {
    this.generation++
    this.made.clear()
    if (embedded) this.set({ state: 'off', items: [] })
    else if (!signedIn) this.set({ state: 'signed_out', items: [] })
    else {
      this.set({ state: 'loading', items: [] })
      void this.load()
    }
  }

  async load(): Promise<void> {
    const generation = this.generation
    let answer: CollectionLoadAnswer<T>
    try {
      answer = await this.rules.load()
    } catch {
      answer = { state: 'unavailable' }
    }
    if (generation !== this.generation) return
    if (answer.state !== 'ready') {
      this.set({ state: answer.state === 'signed_out' ? 'signed_out' : 'unavailable' })
      return
    }
    const keyOf = new Map([...this.made].map(([key, id]) => [id, key]))
    const answered = new Set(answer.items.map((item) => item.id))
    const kept = this.snapshot.items.filter(
      (item) => item.pending || (this.made.has(item.key) && !answered.has(item.id)),
    )
    const loaded = answer.items.map(
      (item): Entry<T> => ({ ...item, key: keyOf.get(item.id) ?? item.id, pending: false }),
    )
    this.set({ state: 'ready', items: [...loaded, ...kept] })
  }

  retry(): void {
    this.set({ state: 'loading' })
    void this.load()
  }

  private failed(problem: P) {
    this.rules.refused(problem)
    if (problem === 'signed_out') this.set({ state: 'signed_out' })
  }

  /** Shows the new item at once under a temporary key; `saved` is its id once the server keeps it, or null. */
  add(input: Input): { key: string; saved: Promise<string | null> } {
    const key = `new-${++this.counter}`
    this.setItems((items) => [...items, { ...this.rules.draft(input, key), key, pending: true }])
    const generation = this.generation
    const saved = this.rules.create(input).then((result) => {
      if (generation !== this.generation) return null
      if (!result.ok) {
        this.replace(key, null)
        this.failed(result.problem)
        return null
      }
      const shown = this.find(key)
      if (!shown) return result.value.id
      const kept = this.rules.settle ? this.rules.settle(shown, result.value) : result.value
      const entry: Entry<T> = { ...kept, key, pending: false }
      this.made.set(key, entry.id)
      this.setItems((items) =>
        items.flatMap((item) => {
          if (item.key === key) return [entry]
          return item.id === entry.id ? [] : [item]
        }),
      )
      return entry.id
    })
    this.ids.set(key, saved)
    return { key, saved }
  }

  private idOf(key: string): Promise<string | null> {
    return this.ids.get(key) ?? Promise.resolve(key)
  }

  /** Shows the change at once and sends it once the item has an id; true when the server kept it. */
  async update(key: string, patch: Partial<T>): Promise<boolean> {
    const before = this.find(key)
    const send = this.rules.update
    if (!before || !send) return false
    this.replace(key, { ...before, ...patch })
    const id = await this.idOf(key)
    if (!id) return false
    const result = await send(id, patch)
    if (result.ok) {
      this.replace(key, { ...result.value, key, pending: false })
      return true
    }
    this.replace(key, result.problem === 'not_found' ? null : before)
    this.failed(result.problem)
    return false
  }

  /** Takes the item away at once, and puts it back if the server couldn't remove it. */
  async remove(key: string): Promise<void> {
    const before = this.find(key)
    if (!before) return
    this.replace(key, null)
    this.made.delete(key)
    const id = await this.idOf(key)
    if (!id) return
    const result = await this.rules.remove(id)
    if (result.ok) return
    if (result.problem !== 'not_found') this.setItems((items) => [...items, before])
    this.failed(result.problem)
  }
}

/** Calls `reload` when the page comes back into view after being hidden for at least `afterMs`. */
export function reloadWhenBack(reload: () => void, afterMs: number, now: () => number = Date.now) {
  let hiddenAt = 0
  return (visibility: DocumentVisibilityState) => {
    if (visibility === 'hidden') hiddenAt = now()
    else if (hiddenAt && now() - hiddenAt >= afterMs) reload()
  }
}
