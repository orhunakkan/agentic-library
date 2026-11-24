import type { ChangeResult } from './post'

/** Where a reader-owned list stands: off when embedded, signed out, loading, ready, or failed to load. */
export type CollectionState = 'off' | 'signed_out' | 'loading' | 'ready' | 'unavailable'

/** One saved thing, under the key the list shows it by: its id, or the temporary key it was created under. */
export type Entry<T> = T & { key: string; pending: boolean }

export interface CollectionSnapshot<T> {
  state: CollectionState
  items: Entry<T>[]
}

/** The fields a list adds to its snapshot when it adds none. */
export type NoExtra = Record<never, never>

type LoadRefusal = { state: 'signed_out' | 'not_found' | 'unavailable' }

export type CollectionLoadAnswer<T> = { state: 'ready'; items: T[] } | LoadRefusal

/** A feature's load answer, which names its things after what they are: `{ state: 'ready', bookmarks }`. */
export type NamedLoadAnswer<K extends string, T> = ({ state: 'ready' } & { [key in K]: T[] }) | LoadRefusal

/** Turns a feature's load answer into the list's, taking its things from under `key`. */
export async function itemsUnder<K extends string, T>(
  key: K,
  answer: Promise<NamedLoadAnswer<K, T>>,
): Promise<CollectionLoadAnswer<T>> {
  const loaded = await answer
  return loaded.state === 'ready' ? { state: 'ready', items: loaded[key] } : loaded
}

/** What one feature passes in: its endpoints, how it shows a refusal, and its own order and merge rules. */
export interface CollectionRules<T extends { id: string }, Input, P extends string> {
  load: () => Promise<CollectionLoadAnswer<T>>
  create: (input: Input) => Promise<ChangeResult<T, P>>
  /** Lists without it offer no updates: `update` throws. */
  update?: (id: string, patch: Partial<T>) => Promise<ChangeResult<T, P>>
  remove: (id: string) => Promise<ChangeResult<true, P>>
  /** Called once when a remove takes something away, for example to say so. */
  removed?: () => void
  /** What the list shows while a create is on its way; `id` is the temporary key until the server answers. */
  draft: (input: Input, key: string) => T
  /** Says why a change was refused. A `signed_out` refusal also signs the list out. */
  refused: (problem: P) => void
  order?: (items: Entry<T>[]) => Entry<T>[]
  /** What to keep when a create's answer arrives, given what the list shows by then; the server's answer by default. */
  settle?: (shown: Entry<T>, saved: T) => T
}

/** A remove or update of one item: how many are on their way, and the last reload sent before the latest finished. */
interface RecentChange {
  inFlight: number
  lastSentBefore: number
}

/** Whether a reload's answer predates `change`, so it must not put back the item's old state. */
function predates(change: RecentChange | undefined, reload: number): boolean {
  return change !== undefined && (change.inFlight > 0 || reload <= change.lastSentBefore)
}

/**
 * A reader-owned list that shows each change at once and sends it in the background. A create gets a temporary
 * key, and later changes to it wait for its id. A reload keeps creates still on their way, and creates that
 * finished after the reload was sent, so its answer can't drop them. Nor can it bring back an item removed, or an
 * old value of an item updated, after it was sent; and an answer older than one already applied is ignored.
 * A feature can carry fields of its own in the snapshot (`X`), and extend the collection with its own behaviour.
 */
export class OptimisticCollection<T extends { id: string }, Input, P extends string, X extends object = NoExtra> {
  protected snapshot: CollectionSnapshot<T> & X
  private readonly listeners = new Set<() => void>()
  private readonly ids = new Map<string, Promise<string | null>>()
  /** Temporary key → id of each create that finished, so a reload shows it under the key it was shown by. */
  private readonly createdIds = new Map<string, string>()
  /** The recent change to each id removed or updated. */
  private readonly changes = new Map<string, RecentChange>()
  private counter = 0
  private generation = 0
  /** How many reloads were sent, and the newest of them whose answer was applied. */
  private reloadsSent = 0
  private lastApplied = 0

  constructor(
    private readonly rules: CollectionRules<T, Input, P>,
    state: CollectionState,
    ...[extra]: NoExtra extends X ? [extra?: X] : [extra: X]
  ) {
    this.snapshot = { ...(extra as X), state, items: [] }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): CollectionSnapshot<T> & X => this.snapshot

  /** Changes the feature's own fields in the snapshot. */
  extend(next: Partial<X>): void {
    this.snapshot = { ...this.snapshot, ...next }
    this.notify()
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

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
    this.notify()
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
    this.createdIds.clear()
    this.changes.clear()
    if (embedded) this.set({ state: 'off', items: [] })
    else if (!signedIn) this.set({ state: 'signed_out', items: [] })
    else {
      this.set({ state: 'loading', items: [] })
      void this.load()
    }
  }

  async load(): Promise<void> {
    const generation = this.generation
    const reload = ++this.reloadsSent
    let answer: CollectionLoadAnswer<T>
    try {
      answer = await this.rules.load()
    } catch {
      answer = { state: 'unavailable' }
    }
    if (generation !== this.generation || reload < this.lastApplied) return
    this.lastApplied = reload
    if (answer.state !== 'ready') {
      this.set({ state: answer.state === 'signed_out' ? 'signed_out' : 'unavailable' })
      return
    }
    const keyOf = new Map([...this.createdIds].map(([key, id]) => [id, key]))
    const shown = new Map(this.snapshot.items.map((item) => [item.id, item]))
    const answered = new Set(answer.items.map((item) => item.id))
    const kept = this.snapshot.items.filter(
      (item) => item.pending || (this.createdIds.has(item.key) && !answered.has(item.id)),
    )
    const loaded = answer.items.flatMap((item): Entry<T>[] => {
      if (!predates(this.changes.get(item.id), reload)) {
        return [{ ...item, key: keyOf.get(item.id) ?? item.id, pending: false }]
      }
      const current = shown.get(item.id)
      return current ? [current] : []
    })
    for (const [id, change] of this.changes) {
      if (!predates(change, reload)) this.changes.delete(id)
    }
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
      this.createdIds.set(key, entry.id)
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

  /**
   * Marks `id` as changing, so no reload answer puts back its old state while the change is on its way, nor one
   * sent before it finished. Returns what to call once the change's answer arrives.
   */
  private beginChange(id: string): () => void {
    const change = this.changes.get(id) ?? { inFlight: 0, lastSentBefore: 0 }
    this.changes.set(id, { ...change, inFlight: change.inFlight + 1 })
    const generation = this.generation
    return () => {
      const now = this.changes.get(id)
      if (generation !== this.generation || !now) return
      this.changes.set(id, { inFlight: now.inFlight - 1, lastSentBefore: this.reloadsSent })
    }
  }

  /** Sends a change to the item shown under `key` once it has an id, marking it as changing meanwhile; null when it never got one. */
  private async sendChange<R>(key: string, shownId: string, send: (id: string) => Promise<R>): Promise<R | null> {
    const endShown = this.beginChange(shownId)
    try {
      const id = await this.idOf(key)
      if (!id) return null
      const endSent = this.beginChange(id)
      try {
        return await send(id)
      } finally {
        endSent()
      }
    } finally {
      endShown()
    }
  }

  /** Shows the change at once and sends it once the item has an id; true when the server kept it. */
  async update(key: string, patch: Partial<T>): Promise<boolean> {
    const send = this.rules.update
    if (!send) throw new Error('This list was built without an update rule, so it offers no updates')
    const before = this.find(key)
    if (!before) return false
    this.replace(key, { ...before, ...patch })
    const result = await this.sendChange(key, before.id, (id) => send(id, patch))
    if (!result) return false
    if (result.ok) {
      this.replace(key, { ...result.value, key, pending: false })
      return true
    }
    this.replace(key, result.problem === 'not_found' ? null : before)
    this.failed(result.problem)
    return false
  }

  /** Takes the items away at once, and puts back any the server couldn't remove. */
  async remove(keys: string | readonly string[]): Promise<void> {
    const shown = (typeof keys === 'string' ? [keys] : keys).flatMap((key) => this.find(key) ?? [])
    if (!shown.length) return
    const removing = shown.map((item) => this.removeOne(item))
    this.rules.removed?.()
    await Promise.all(removing)
  }

  private async removeOne(before: Entry<T>): Promise<void> {
    const { key } = before
    this.replace(key, null)
    this.createdIds.delete(key)
    const result = await this.sendChange(key, before.id, (id) => this.rules.remove(id))
    if (!result || result.ok) return
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
