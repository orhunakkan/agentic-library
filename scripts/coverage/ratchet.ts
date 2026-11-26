import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'

export const METRICS = ['statements', 'branches', 'functions', 'lines'] as const
export type Metric = (typeof METRICS)[number]
export type Totals = Record<Metric, number>

export interface Raise {
  metric: Metric
  from: number
  to: number
}

/** A per-file floor raised to its file's coverage. */
export interface FileRaise extends Raise {
  file: string
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads a json-summary coverage report into each file's four percentages, keyed by its path from `root` with forward
 * slashes. The report's `total`, and any row without four numeric percentages, are left out.
 */
export function parseFileSummary(report: unknown, root: string): Map<string, Totals> {
  const files = new Map<string, Totals>()
  if (!isRecord(report)) return files
  for (const [path, row] of Object.entries(report)) {
    if (path === 'total' || !isRecord(row)) continue
    const totals: Partial<Totals> = {}
    for (const metric of METRICS) {
      const counts = row[metric]
      const pct = isRecord(counts) ? counts.pct : undefined
      if (typeof pct === 'number') totals[metric] = pct
    }
    if (METRICS.every((metric) => totals[metric] !== undefined))
      files.set(relative(root, path).replaceAll('\\', '/'), totals as Totals)
  }
  return files
}

const FILE_FLOOR = /^(\s*)'([^']+)': \{ statements: (\d+), branches: (\d+), functions: (\d+), lines: (\d+) \},$/gm
const FILE_ENTRY = /^\s*'([^'*]+)':/gm

/**
 * Raises each inline per-file floor under `thresholds` to its file's coverage, rounded down, metric by metric. It
 * never lowers one and leaves `FULL` entries as they are. A floor whose four metrics reach 100 becomes `FULL` when
 * the config defines it. Files with a threshold but no row in `files` are left alone and listed in `missing`.
 */
export function ratchetFiles(
  config: string,
  files: Map<string, Totals>,
): { config: string; raised: FileRaise[]; missing: string[] } {
  const start = config.indexOf('thresholds: {')
  if (start < 0) return { config, raised: [], missing: [] }
  const head = config.slice(0, start)
  const block = config.slice(start)
  const missing = [...block.matchAll(FILE_ENTRY)].map((match) => match[1] as string).filter((file) => !files.has(file))
  const hasFull = /^const FULL = /m.test(config)
  const raised: FileRaise[] = []
  const next = block.replace(FILE_FLOOR, (line, indent: string, file: string, ...floors: string[]) => {
    const actual = files.get(file)
    if (!actual) return line
    const to = METRICS.map((metric, i) => {
      const from = Number(floors[i])
      const floor = Math.floor(actual[metric])
      if (floor > from) raised.push({ file, metric, from, to: floor })
      return Math.max(from, floor)
    })
    if (hasFull && to.every((percent) => percent >= 100)) return `${indent}'${file}': FULL,`
    const metrics = METRICS.map((metric, i) => `${metric}: ${to[i]}`).join(', ')
    return `${indent}'${file}': { ${metrics} },`
  })
  return { config: head + next, raised, missing }
}

function newestUnder(dir: string): number {
  return Math.max(
    ...readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((name) => statSync(`${dir}/${name}`).mtimeMs),
  )
}

const SIDES = [
  {
    label: 'unit',
    run: 'pnpm test',
    config: 'vitest.config.ts',
    summary: 'coverage/unit/summary.txt',
    perFile: 'coverage/unit/coverage-summary.json',
  },
  {
    label: 'server',
    run: 'pnpm test:db',
    config: 'vitest.db.config.ts',
    summary: 'coverage/server/summary.txt',
    perFile: 'coverage/server/coverage-summary.json',
  },
  {
    label: 'browser',
    run: 'pnpm test:browser',
    config: 'vitest.browser.config.ts',
    summary: 'coverage/browser/summary.txt',
    perFile: 'coverage/browser/coverage-summary.json',
  },
]

function main(): void {
  const newestSource = newestUnder('src')
  for (const side of SIDES) {
    let summary: string
    let perFile: unknown
    try {
      const stale = [side.summary, side.perFile].find((file) => statSync(file).mtimeMs < newestSource)
      if (stale) {
        console.log(`${side.label}: ${stale} is older than src/; run \`${side.run}\` and try again.`)
        continue
      }
      summary = readFileSync(side.summary, 'utf8')
      perFile = JSON.parse(readFileSync(side.perFile, 'utf8'))
    } catch {
      console.log(`${side.label}: no ${side.summary} or ${side.perFile}; run \`${side.run}\` first.`)
      continue
    }
    const totals = parseSummary(summary)
    if (!totals) {
      console.log(`${side.label}: ${side.summary} has no coverage summary in it; run \`${side.run}\` again.`)
      continue
    }
    const overall = ratchet(readFileSync(side.config, 'utf8'), totals)
    const files = ratchetFiles(overall.config, parseFileSummary(perFile, process.cwd()))
    for (const file of files.missing)
      console.log(`${side.label}: ${file} has a threshold but no row in ${side.perFile}; left as it is.`)
    if (overall.raised.length === 0 && files.raised.length === 0) {
      console.log(`${side.label}: every threshold already matches the coverage, rounded down.`)
      continue
    }
    writeFileSync(side.config, files.config)
    if (overall.raised.length > 0) {
      const list = overall.raised.map((r) => `${r.metric} ${r.from} → ${r.to}`).join(', ')
      console.log(`${side.label}: raised in ${side.config}: ${list}.`)
    }
    for (const r of files.raised) console.log(`${side.label}: raised ${r.file} ${r.metric} ${r.from} → ${r.to}`)
  }
}

if (import.meta.main) main()
