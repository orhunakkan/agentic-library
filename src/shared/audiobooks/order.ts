export interface Mp3Order {
  name: string
  disc: number | null
  track: number | null
}

const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function playOrder(files: readonly Mp3Order[]): number[] {
  const indices = files.map((_, i) => i)
  const byName = (a: number, b: number) => natural.compare(files[a]?.name ?? '', files[b]?.name ?? '') || a - b
  if (files.some((f) => f.track === null)) return indices.sort(byName)
  return indices.sort((a, b) => {
    const x = files[a] as Mp3Order
    const y = files[b] as Mp3Order
    return (x.disc ?? 1) - (y.disc ?? 1) || (x.track ?? 0) - (y.track ?? 0) || byName(a, b)
  })
}

export function titleFromFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[^.]{1,5}$/, '')
  const title = base
    .replace(/^\s*\d{1,4}\s*[-–—._)]\s*/, '')
    .replace(/_/g, ' ')
    .trim()
  return title || base.trim()
}
