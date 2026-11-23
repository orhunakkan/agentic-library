import type { RunLang } from '~/shared/run-code/langs'

export const MAX_RUN_CODE = 100_000

export const RUN_TIME_LIMIT: Record<RunLang, number> = {
  javascript: 5_000,
  typescript: 5_000,
  python: 10_000,
  sql: 5_000,
}

export const ENGINE_LOAD_LIMIT = 60_000

export type Engine = 'python' | 'sqlite'
export type OutputLevel = 'log' | 'info' | 'warn' | 'error'

export type OutputEntry =
  | { t: 'line'; level: OutputLevel; text: string; indent: number }
  | { t: 'table'; columns: string[]; rows: string[][] }
  | { t: 'clear' }

export interface RunError {
  message: string
  line?: number
}

export type FrameLang = 'javascript' | 'python' | 'sql'

export interface RunRequest {
  kind: 'run'
  id: string
  lang: FrameLang
  code: string
  engineBase: string
}

export type FrameMessage =
  | { kind: 'ready' }
  | { kind: 'loading'; id: string; engine: Engine }
  | { kind: 'started'; id: string }
  | { kind: 'output'; id: string; entries: OutputEntry[] }
  | { kind: 'done'; id: string; ms: number; error?: RunError }
  | { kind: 'failed'; id: string; reason: 'engine' | 'worker' }

const MAX_ENTRIES = 1_000
const MAX_TEXT = 20_000
const MAX_ROWS = 1_000
const MAX_COLUMNS = 100
const MAX_INDENT = 100
const MAX_ID = 64
const LEVELS: readonly string[] = ['log', 'info', 'warn', 'error']

type Fields = Record<string, unknown>

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasKeys(value: Fields, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value)
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k))
}

const isText = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.length <= max
const isId = (value: unknown): value is string => isText(value, MAX_ID) && value.length > 0
const isCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
const isTextRow = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((cell) => isText(cell))

function isEntry(value: unknown): value is OutputEntry {
  if (!isObject(value)) return false
  switch (value.t) {
    case 'line':
      return (
        hasKeys(value, ['t', 'level', 'text', 'indent']) &&
        LEVELS.includes(value.level as string) &&
        isText(value.text) &&
        isCount(value.indent, MAX_INDENT)
      )
    case 'table':
      return (
        hasKeys(value, ['t', 'columns', 'rows']) &&
        isTextRow(value.columns, MAX_COLUMNS) &&
        Array.isArray(value.rows) &&
        value.rows.length <= MAX_ROWS &&
        value.rows.every((row) => isTextRow(row, MAX_COLUMNS))
      )
    case 'clear':
      return hasKeys(value, ['t'])
    default:
      return false
  }
}

function isRunError(value: unknown): value is RunError {
  if (!isObject(value) || !hasKeys(value, ['message'], ['line']) || !isText(value.message)) return false
  return value.line === undefined || (isCount(value.line, 10_000_000) && value.line > 0)
}

export function parseFrameMessage(value: unknown): FrameMessage | null {
  if (!isObject(value)) return null
  const { kind, id } = value
  if (kind === 'ready') return hasKeys(value, ['kind']) ? { kind } : null
  if (!isId(id)) return null
  switch (kind) {
    case 'loading':
      return hasKeys(value, ['kind', 'id', 'engine']) && (value.engine === 'python' || value.engine === 'sqlite')
        ? { kind, id, engine: value.engine }
        : null
    case 'started':
      return hasKeys(value, ['kind', 'id']) ? { kind, id } : null
    case 'output': {
      const { entries } = value
      if (!hasKeys(value, ['kind', 'id', 'entries']) || !Array.isArray(entries) || entries.length > MAX_ENTRIES)
        return null
      return entries.every(isEntry) ? { kind, id, entries } : null
    }
    case 'done': {
      const { ms, error } = value
      if (!hasKeys(value, ['kind', 'id', 'ms'], ['error'])) return null
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null
      if (error === undefined) return { kind, id, ms }
      if (!isRunError(error)) return null
      return {
        kind,
        id,
        ms,
        error: error.line ? { message: error.message, line: error.line } : { message: error.message },
      }
    }
    case 'failed':
      return hasKeys(value, ['kind', 'id', 'reason']) && (value.reason === 'engine' || value.reason === 'worker')
        ? { kind, id, reason: value.reason }
        : null
    default:
      return null
  }
}
