import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'

export type LineHits = Map<string, Map<number, number>>
export type ChangedLines = Map<string, Set<number>>

export interface ChangedCoverage {
  covered: number
  total: number
  uncovered: Map<string, number[]>
}

const NO_COMMIT = /^0+$/

export function repoPath(path: string, root: string): string {
  const normalized = path.replaceAll('\\', '/')
  const base = root.replaceAll('\\', '/').replace(/\/$/, '')
  if (normalized.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return normalized.slice(base.length + 1)
  return normalized.replace(/^\.\//, '')
}

export function parseLcov(text: string, root: string): LineHits {
  const files: LineHits = new Map()
  let current: Map<number, number> | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('SF:')) {
      current = new Map()
      files.set(repoPath(line.slice(3), root), current)
    } else if (line.startsWith('DA:') && current) {
      const [lineNumber, hits] = line.slice(3).split(',')
      current.set(Number(lineNumber), Number(hits))
    } else if (line === 'end_of_record') {
      current = undefined
    }
  }
  return files
}

export function parseDiff(text: string): ChangedLines {
  const files: ChangedLines = new Map()
  let current: Set<number> | undefined
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim()
      if (path === '/dev/null') {
        current = undefined
      } else {
        current = new Set()
        files.set(path.replace(/^b\//, ''), current)
      }
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk && current) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      for (let n = start; n < start + count; n++) current.add(n)
    }
  }
  return files
}

export function changedCoverage(hits: LineHits, changed: ChangedLines): ChangedCoverage {
  const result: ChangedCoverage = { covered: 0, total: 0, uncovered: new Map() }
  for (const [file, lines] of changed) {
    const fileHits = hits.get(file)
    if (!fileHits) continue
    const missed: number[] = []
    for (const line of [...lines].sort((a, b) => a - b)) {
      const count = fileHits.get(line)
      if (count === undefined) continue
      result.total++
      if (count > 0) result.covered++
      else missed.push(line)
    }
    if (missed.length > 0) result.uncovered.set(file, missed)
  }
  return result
}

export function lineRanges(lines: number[]): string[] {
  const ranges: [number, number][] = []
  for (const line of lines) {
    const last = ranges.at(-1)
    if (last && line === last[1] + 1) last[1] = line
    else ranges.push([line, line])
  }
  return ranges.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`))
}

export function resolveRange(range: string | undefined): string {
  const [base, head] = (range ?? '').split('..')
  if (!base || NO_COMMIT.test(base)) return 'HEAD~1..HEAD'
  return `${base}..${head || 'HEAD'}`
}

const reportHeading = (label: string) => `#### Changed lines covered (${label})`

export function formatReport(label: string, result: ChangedCoverage): string {
  const heading = reportHeading(label)
  if (result.total === 0) return `${heading}\n\nNo measurable lines changed.\n`
  const percent = ((result.covered / result.total) * 100).toFixed(1)
  const lines = [heading, '', `**${percent}%** (${result.covered} of ${result.total} lines). Advisory; nothing fails.`]
  if (result.uncovered.size > 0) {
    lines.push('', 'Uncovered:', '')
    for (const [file, missed] of result.uncovered) {
      for (const range of lineRanges(missed)) lines.push(`- \`${file}:${range}\``)
    }
  }
  return `${lines.join('\n')}\n`
}

function report(lcovPath: string | undefined, rangeArg: string | undefined, label: string): string {
  const heading = reportHeading(label)
  if (!lcovPath || !existsSync(lcovPath))
    return `${heading}\n\nNo report: \`${lcovPath ?? '(none given)'}\` is missing.\n`
  const range = resolveRange(rangeArg)
  let diff: string
  try {
    diff = execFileSync('git', ['diff', '--unified=0', '--no-color', '--no-renames', range, '--', '*.ts'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return `${heading}\n\nNo report: git could not diff \`${range}\` (is the base commit fetched?).\n`
  }
  const hits = parseLcov(readFileSync(lcovPath, 'utf8'), process.cwd())
  return formatReport(label, changedCoverage(hits, parseDiff(diff)))
}

if (import.meta.main) {
  const [lcovPath, range, label] = process.argv.slice(2)
  try {
    process.stdout.write(report(lcovPath, range, label ?? (lcovPath ? relative('.', lcovPath) : 'coverage')))
  } catch (error) {
    process.stdout.write(`Changed-lines report failed: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.exitCode = 0
}
