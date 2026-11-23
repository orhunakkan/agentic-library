import { langLabel, type RunLang } from '~/shared/run-code/langs'
import { RUN_TIME_LIMIT } from './sandbox/protocol'

export type RunStatus =
  | 'idle'
  | 'loading'
  | 'running'
  | 'done'
  | 'error'
  | 'timeout'
  | 'stopped'
  | 'capped'
  | 'engine_failed'
  | 'failed'

export interface StatusFacts {
  status: RunStatus
  lang: RunLang
  mac: boolean
  ms?: number
  empty?: boolean
  line?: number
}

export const shortcutText = (mac: boolean): string => (mac ? '⌘+Enter' : 'Ctrl+Enter')

export function durationText(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

const engineName = (lang: RunLang) => (lang === 'sql' ? 'SQLite' : langLabel(lang))

export function statusText({ status, lang, mac, ms = 0, empty = false, line }: StatusFacts): string {
  switch (status) {
    case 'idle':
      return `Press Run, or ${shortcutText(mac)}.`
    case 'loading':
      return lang === 'python'
        ? 'Getting Python ready. The first time downloads about 12 MB.'
        : `Getting ${engineName(lang)} ready.`
    case 'running':
      return 'Running…'
    case 'done':
      return empty ? `Finished in ${durationText(ms)}, with no output.` : `Finished in ${durationText(ms)}.`
    case 'error':
      return line ? `Stopped by an error on line ${line}.` : 'Stopped by an error.'
    case 'timeout':
      return `Stopped after ${RUN_TIME_LIMIT[lang] / 1000} seconds. A loop or a timer may never end.`
    case 'stopped':
      return 'Stopped.'
    case 'capped':
      return 'Stopped: the output reached its limit.'
    case 'engine_failed':
      return `Couldn’t get ${engineName(lang)} ready. Check your connection and try again.`
    case 'failed':
      return 'Something went wrong. Try again.'
  }
}

const NODE_ONLY = /\b(require|process) is not defined\b|Cannot find module/
const NO_PAGE = /\b(document|window) is not defined\b/
const MODULE_FAILED =
  /module specifier|dynamically imported module|bare specifier|Importing a module script failed|error loading .*module/i
const NO_NETWORK =
  /Failed to fetch|NetworkError|Failed to parse URL|is not a valid URL|Load failed|Content Security Policy|violates the following/i

export const HINTS = {
  node: 'This example is written for Node.js. Folio runs JavaScript as a browser does, without Node’s modules.',
  page: 'This example works with a web page. Code here runs without one, so it can only print.',
  module: 'Code here can’t load other files or packages. Only this example’s own code runs.',
  network: 'Code here has no network access.',
  python: 'Folio runs Python with its standard library only, so this module isn’t available.',
  input: 'input() can’t ask for text here. Put the value in the code instead.',
  table: 'Each run starts with an empty database. Create the table in the same example first.',
} as const

export function hintFor(lang: RunLang, message: string): string | null {
  if (lang === 'javascript' || lang === 'typescript') {
    if (NODE_ONLY.test(message)) return HINTS.node
    if (NO_PAGE.test(message)) return HINTS.page
    if (MODULE_FAILED.test(message)) return HINTS.module
    if (NO_NETWORK.test(message)) return HINTS.network
    return null
  }
  if (lang === 'python') {
    if (/^ModuleNotFoundError\b/.test(message)) return HINTS.python
    if (/input\(\) isn’t available|input\(\) isn't available/.test(message)) return HINTS.input
    if (NO_NETWORK.test(message)) return HINTS.network
    return null
  }
  return /no such table/.test(message) ? HINTS.table : null
}

export const titleText = (lang: RunLang): string => `${langLabel(lang)} example`

export const openLabel = (lang: RunLang): string => `Run ${titleText(lang)}`

export const TYPESCRIPT_NOTE = 'Types aren’t checked here. They’re removed, and the code runs as JavaScript.'
export const OUTPUT_EMPTY = 'Output appears here.'
export const SIGNED_OUT_TEXT = 'Sign in to run code. Running code is part of Pro.'
export const ROWS_CUT = (rows: number) => `Only the first ${rows} rows are shown.`
export const COLUMNS_CUT = (columns: number) => `Only the first ${columns} columns are shown.`
