import type { Collection } from './schema'

export type Hue = 'violet' | 'coral' | 'cyan' | 'lime' | 'amber' | 'pink'

const CYCLE: readonly Hue[] = ['violet', 'coral', 'cyan', 'lime', 'pink']

export const PRIVATE_SHELF_HUE: Hue = 'pink'

export const READER_SHELF_HUE: Hue = 'violet'

export function collectionHues(collections: readonly Pick<Collection, 'slug' | 'order' | 'tone'>[]): Map<string, Hue> {
  const hues = new Map<string, Hue>()
  let next = 0
  for (const c of [...collections].sort((a, b) => a.order - b.order)) {
    if (c.tone === 'warm') hues.set(c.slug, 'amber')
    else hues.set(c.slug, CYCLE[next++ % CYCLE.length] as Hue)
  }
  return hues
}
