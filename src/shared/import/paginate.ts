import type { Block } from './render.ts'

export const PAGE_MIN = 450
export const PAGE_MAX = 650

function pageCost(words: number, endsWithHeading: boolean): number {
  let cost = 0
  if (words < PAGE_MIN) cost += (PAGE_MIN - words) ** 2
  else if (words > PAGE_MAX) cost += (words - PAGE_MAX) ** 2
  cost += 1000
  if (endsWithHeading) cost += 1e9
  return cost
}

function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i]
  if (v === undefined) throw new Error(`paginate: index ${i} out of range`)
  return v
}

export function paginate(blocks: Block[]): string[] {
  const blockCount = blocks.length
  if (blockCount === 0) return []
  const prefix = [0]
  let running = 0
  for (const b of blocks) {
    running += b.words
    prefix.push(running)
  }
  const total = running
  if (total <= PAGE_MAX) return [blocks.map((b) => b.html).join('')]

  const best = new Array<number>(blockCount + 1).fill(Infinity)
  const from = new Array<number>(blockCount + 1).fill(-1)
  best[0] = 0
  const hardMax = PAGE_MAX * 3
  for (let i = 1; i <= blockCount; i++) {
    const endsWithHeading = at(blocks, i - 1).heading
    for (let j = i - 1; j >= 0; j--) {
      const words = at(prefix, i) - at(prefix, j)
      if (words > hardMax && i - j > 1) break
      const before = at(best, j)
      if (before === Infinity) continue
      const c = before + pageCost(words, endsWithHeading)
      if (c < at(best, i)) {
        best[i] = c
        from[i] = j
      }
    }
  }
  const pages: string[] = []
  let i = blockCount
  while (i > 0) {
    const j = at(from, i)
    pages.unshift(
      blocks
        .slice(j, i)
        .map((b) => b.html)
        .join(''),
    )
    i = j
  }
  return pages
}
