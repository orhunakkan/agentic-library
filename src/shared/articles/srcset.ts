import { PICTURE_MAX_CHOSEN_WIDTH } from './contract.ts'

export interface SrcsetCandidate {
  url: string
  width: number | null
  density: number | null
}

export function parseSrcset(value: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = []
  let at = 0
  while (at < value.length) {
    while (at < value.length && /[\s,]/.test(value[at] as string)) at++
    if (at >= value.length) break
    let end = at
    while (end < value.length && !/\s/.test(value[end] as string)) end++
    let url = value.slice(at, end)
    at = end
    let descriptors = ''
    if (url.endsWith(',')) url = url.replace(/,+$/, '')
    else {
      const comma = value.indexOf(',', at)
      descriptors = value.slice(at, comma === -1 ? value.length : comma)
      at = comma === -1 ? value.length : comma + 1
    }
    if (!url) continue
    let width: number | null = null
    let density: number | null = null
    for (const d of descriptors.trim().split(/\s+/).filter(Boolean)) {
      const m = /^(\d+(?:\.\d+)?)([wx])$/i.exec(d)
      if (!m) continue
      if ((m[2] as string).toLowerCase() === 'w') width = Math.round(Number(m[1]))
      else density = Number(m[1])
    }
    out.push({ url, width, density: width === null && density === null ? 1 : density })
  }
  return out
}

export function chooseCandidate(candidates: readonly SrcsetCandidate[]): string | null {
  if (!candidates.length) return null
  const widths = candidates.filter((c) => c.width !== null)
  if (widths.length) {
    const sorted = [...widths].sort((a, b) => (a.width as number) - (b.width as number))
    const fitting = sorted.filter((c) => (c.width as number) <= PICTURE_MAX_CHOSEN_WIDTH)
    return (fitting.at(-1) ?? sorted[0])?.url ?? null
  }
  const sorted = [...candidates].sort((a, b) => (a.density ?? 1) - (b.density ?? 1))
  const fitting = sorted.filter((c) => (c.density ?? 1) <= 2)
  return (fitting.at(-1) ?? sorted[0])?.url ?? null
}
