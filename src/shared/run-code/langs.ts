import { isOneOf } from '../lib/json-shape.ts'

export const RUN_LANGS = ['javascript', 'typescript', 'python', 'sql'] as const
export type RunLang = (typeof RUN_LANGS)[number]

export function isRunLang(value: unknown): value is RunLang {
  return isOneOf(value, RUN_LANGS)
}

const ALIASES: Record<string, RunLang> = {
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  python: 'python',
  python3: 'python',
  sql: 'sql',
  sqlite: 'sql',
  sqlite3: 'sql',
}

export function aliasLang(name: string): RunLang | null {
  const alias = name.toLowerCase()
  return Object.hasOwn(ALIASES, alias) ? (ALIASES[alias] as RunLang) : null
}

export interface HintSource {
  getAttribute(name: string): string | null | undefined
}

const ATTRIBUTES = ['data-code-language', 'data-lang', 'data-language'] as const

function classHint(classes: string): string | null {
  const tokens = classes.split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    const named = /^(?:language|lang)-(.*)$/i.exec(token)
    if (named) return named[1] ?? ''
  }
  const brush = /(?:^|[\s;])brush:\s*([^\s;]*)/i.exec(classes)
  if (brush) return brush[1] ?? ''
  if (tokens.includes('sourceCode')) return tokens.find((t) => t !== 'sourceCode' && aliasLang(t)) ?? null
  return null
}

function hintOf(element: HintSource): string | null {
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name)?.trim()
    if (value) return value
  }
  const classes = element.getAttribute('class')
  return classes ? classHint(classes) : null
}

export function codeLang(elements: readonly HintSource[]): RunLang | null {
  for (const element of elements) {
    const hint = hintOf(element)
    if (hint !== null) return aliasLang(hint)
  }
  return null
}

export function fenceLang(info: string | null | undefined): RunLang | null {
  const word = info?.trim().split(/\s+/)[0]
  return word ? aliasLang(word.replace(/^\{?\.?/, '').replace(/[,}]$/, '')) : null
}

const EXTENSIONS: Record<string, RunLang> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  sql: 'sql',
}

export function fileLang(path: string): RunLang | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return Object.hasOwn(EXTENSIONS, ext) ? (EXTENSIONS[ext] as RunLang) : null
}

const LABELS: Record<RunLang, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  sql: 'SQL',
}

export function langLabel(lang: RunLang): string {
  return LABELS[lang]
}
