import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'

export const METRICS = ['statements', 'branches', 'functions', 'lines'] as const
export type Metric = (typeof METRICS)[number]
export type Totals = Record<Metric, number>

export interface Raise {
  metric: Metric
  from: number
  to: number
}

export function parseSummary(text: string): Totals | null {
  const totals: Partial<Totals> = {}
  for (const metric of METRICS) {
    const match = new RegExp(`^${metric}\\s*:\\s*([\\d.]+)%`, 'im').exec(text)
    if (!match) return null
    totals[metric] = Number(match[1])
  }
  return totals as Totals
}

export function ratchet(config: string, totals: Totals): { config: string; raised: Raise[] } {
  const start = config.indexOf('thresholds: {')
  if (start < 0) throw new Error('no `thresholds: {` in the config')
  const rest = config.slice(start)
  const end = Math.min(...[rest.indexOf("'"), rest.indexOf('}')].filter((i) => i >= 0))
  let head = rest.slice(0, end)
  const raised: Raise[] = []
  for (const metric of METRICS) {
    const pattern = new RegExp(`\\b${metric}: (\\d+)`)
    const match = pattern.exec(head)
    if (!match) throw new Error(`no overall ${metric} threshold in the config`)
    const from = Number(match[1])
    const to = Math.floor(totals[metric])
    if (to > from) {
      head = head.replace(pattern, `${metric}: ${to}`)
      raised.push({ metric, from, to })
    }
  }
  return { config: config.slice(0, start) + head + rest.slice(end), raised }
}

function newestUnder(dir: string): number {
  return Math.max(
    ...readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((name) => statSync(`${dir}/${name}`).mtimeMs),
  )
}

const SIDES = [
  { label: 'unit', run: 'pnpm test', config: 'vitest.config.ts', summary: 'coverage/unit/summary.txt' },
  { label: 'server', run: 'pnpm test:db', config: 'vitest.db.config.ts', summary: 'coverage/server/summary.txt' },
]

function main(): void {
  const newestSource = newestUnder('src')
  for (const side of SIDES) {
    let summary: string
    try {
      if (statSync(side.summary).mtimeMs < newestSource) {
        console.log(`${side.label}: ${side.summary} is older than src/; run \`${side.run}\` and try again.`)
        continue
      }
      summary = readFileSync(side.summary, 'utf8')
    } catch {
      console.log(`${side.label}: no ${side.summary}; run \`${side.run}\` first.`)
      continue
    }
    const totals = parseSummary(summary)
    if (!totals) {
      console.log(`${side.label}: ${side.summary} has no coverage summary in it; run \`${side.run}\` again.`)
      continue
    }
    const { config, raised } = ratchet(readFileSync(side.config, 'utf8'), totals)
    if (raised.length === 0) {
      console.log(`${side.label}: every threshold already matches the coverage, rounded down.`)
      continue
    }
    writeFileSync(side.config, config)
    const list = raised.map((r) => `${r.metric} ${r.from} → ${r.to}`).join(', ')
    console.log(`${side.label}: raised in ${side.config}: ${list}.`)
  }
}

if (import.meta.main) main()
