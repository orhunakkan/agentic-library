import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { type ApiCall, DESIRED, type DesiredSetting, type Expectation, type JsonValue } from './desired.ts'

/**
 * GitHub settings as code (spec/SPEC-repo-security.md, section 6).
 *
 *   node scripts/github/settings.ts --check [--repo owner/name]   print every difference; exit 1 if there is any
 *   node scripts/github/settings.ts --apply [--repo owner/name]   set what differs, then run --check again
 *
 * It runs `gh` with the owner's login, so it never handles a token itself. Every answer is `unknown` until it's
 * narrowed. The comparison, `checkSettings`, is a pure function over recorded answers, tested without a network.
 */

/** What one `gh api` read answered: its HTTP status, and its JSON body, or null when there was none. */
export interface ApiAnswer {
  status: number
  body: unknown
}

export type Answers = ReadonlyMap<string, ApiAnswer>

export type VerdictState = 'matches' | 'differs' | 'missing' | 'unreadable'

export interface Verdict {
  setting: DesiredSetting
  state: VerdictState
  /** What was found, when it isn't what's wanted. */
  found: string
  /** For a ruleset that exists but differs, its id, to update it in place. */
  rulesetId?: number
}

export interface Target {
  repo: string
  owner: string
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

export const pathFor = (path: string, target: Target) =>
  path.replaceAll('{repo}', target.repo).replaceAll('{owner}', target.owner)

/**
 * Whether `actual` holds everything in `wanted`: objects may have more fields, while lists must have the same length,
 * each wanted item held by a different actual item, in any order.
 */
export function holds(actual: unknown, wanted: JsonValue): boolean {
  if (Array.isArray(wanted)) {
    if (!Array.isArray(actual) || actual.length !== wanted.length) return false
    const unused = [...actual]
    return wanted.every((item) => {
      const index = unused.findIndex((candidate) => holds(candidate, item))
      if (index === -1) return false
      unused.splice(index, 1)
      return true
    })
  }
  if (wanted !== null && typeof wanted === 'object')
    return isRecord(actual) && Object.entries(wanted).every(([key, value]) => holds(actual[key], value))
  return actual === wanted
}

const ok2xx = (answer: ApiAnswer) => answer.status >= 200 && answer.status < 300

const shown = (candidate: unknown) => {
  const text = JSON.stringify(candidate) ?? String(candidate)
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}

/** The list a list expectation reads: the body itself, or one of its fields. */
function listOf(body: unknown, list: string | undefined): unknown[] | null {
  const candidate = list ? (isRecord(body) ? body[list] : undefined) : body
  return Array.isArray(candidate) ? candidate : null
}

/** The fields of a ruleset that the import format sets. Anything else GitHub adds (ids, dates, links) is ignored. */
const RULESET_FIELDS = ['name', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors'] as const

function checkRuleset(
  setting: DesiredSetting,
  name: string,
  answers: Answers,
  rulesets: Readonly<Record<string, JsonValue>>,
  target: Target,
): Verdict {
  const listPath = pathFor(setting.read, target)
  const list = answers.get(listPath)
  if (!list || !ok2xx(list))
    return { setting, state: 'unreadable', found: `rulesets answered ${list?.status ?? 'nothing'}` }
  const entries = listOf(list.body, undefined)
  if (!entries) return { setting, state: 'unreadable', found: `rulesets answered ${shown(list.body)}` }
  const summary = entries.find((entry) => isRecord(entry) && entry.name === name)
  const id = isRecord(summary) && typeof summary.id === 'number' ? summary.id : null
  if (id === null) return { setting, state: 'missing', found: 'no ruleset by that name' }
  const detail = answers.get(`${listPath}/${id}`)
  if (!detail || !ok2xx(detail) || !isRecord(detail.body))
    return {
      setting,
      state: 'unreadable',
      found: `ruleset ${id} answered ${detail?.status ?? 'nothing'}`,
      rulesetId: id,
    }
  const body = detail.body
  const wanted = rulesets[name]
  if (!isRecord(wanted)) throw new Error(`.github/rulesets/${name}.json isn't a ruleset`)
  const differing = RULESET_FIELDS.filter((field) => {
    const want = wanted[field]
    return want !== undefined && !holds(body[field], want)
  })
  return differing.length
    ? { setting, state: 'differs', found: `differs in ${differing.join(', ')}`, rulesetId: id }
    : { setting, state: 'matches', found: '', rulesetId: id }
}

function checkAnswer(
  setting: DesiredSetting,
  expect: Exclude<Expectation, { kind: 'ruleset' }>,
  answer: ApiAnswer,
  target: Target,
): Verdict {
  if (expect.kind === 'status')
    return answer.status === expect.status
      ? { setting, state: 'matches', found: '' }
      : { setting, state: 'differs', found: `answered ${answer.status}, not ${expect.status}` }
  if (!ok2xx(answer))
    return {
      setting,
      state: answer.status === 404 ? 'missing' : 'unreadable',
      found: `answered ${answer.status}: ${shown(answer.body)}`,
    }
  if (expect.kind === 'fields') {
    if (!isRecord(answer.body)) return { setting, state: 'unreadable', found: `answered ${shown(answer.body)}` }
    const body = answer.body
    const differing = Object.entries(expect.fields).filter(([field, value]) => !holds(body[field], value))
    return differing.length
      ? { setting, state: 'differs', found: differing.map(([field]) => `${field}: ${shown(body[field])}`).join('; ') }
      : { setting, state: 'matches', found: '' }
  }
  const items = listOf(answer.body, expect.list)
  if (!items) return { setting, state: 'unreadable', found: `answered ${shown(answer.body)}` }
  if (expect.kind === 'each') {
    const failing = items.filter((item) => !holds(item, expect.fields))
    return failing.length
      ? { setting, state: 'differs', found: `${failing.length} of ${items.length} don't have ${shown(expect.fields)}` }
      : { setting, state: 'matches', found: '' }
  }
  const values = items.map((item) => (isRecord(item) ? item[expect.field] : undefined))
  const wanted = expect.values.map((value) => pathFor(value, target))
  return holds(values, wanted)
    ? { setting, state: 'matches', found: '' }
    : { setting, state: 'differs', found: `${expect.field} is ${shown(values)}, not ${shown(wanted)}` }
}

/** How each desired setting compares with the answers read from GitHub. */
export function checkSettings(
  desired: readonly DesiredSetting[],
  answers: Answers,
  rulesets: Readonly<Record<string, JsonValue>>,
  target: Target,
): Verdict[] {
  return desired.map((setting) => {
    if (setting.expect.kind === 'ruleset') return checkRuleset(setting, setting.expect.name, answers, rulesets, target)
    const answer = answers.get(pathFor(setting.read, target))
    if (!answer) return { setting, state: 'unreadable', found: 'not read' }
    return checkAnswer(setting, setting.expect, answer, target)
  })
}

/** The calls that would fix a verdict, or what the owner has to do by hand. */
export function fixFor(verdict: Verdict, rulesets: Readonly<Record<string, JsonValue>>): ApiCall[] | string {
  const { setting } = verdict
  if (setting.expect.kind === 'ruleset') {
    const body = rulesets[setting.expect.name]
    if (!isRecord(body)) throw new Error(`no ruleset file for ${setting.expect.name}`)
    return verdict.rulesetId === undefined
      ? [{ method: 'POST', path: '/repos/{repo}/rulesets', body }]
      : [{ method: 'PUT', path: `/repos/{repo}/rulesets/${verdict.rulesetId}`, body }]
  }
  return 'byHand' in setting.apply ? setting.apply.byHand : [...setting.apply]
}

export function report(verdicts: readonly Verdict[]): { lines: string[]; differences: number } {
  const lines = verdicts.map(({ setting, state, found }) => {
    const label = `${setting.label}${setting.needsPublic ? ' [applied by go-public]' : ''}`
    return state === 'matches' ? `matches    ${label}` : `${state.padEnd(10)} ${label}: ${found}`
  })
  const differing = verdicts.filter((verdict) => verdict.state !== 'matches')
  const publicOnly = differing.filter((verdict) => verdict.setting.needsPublic).length
  lines.push(
    differing.length
      ? `${differing.length} difference(s), ${publicOnly} of them in rows applied by go-public`
      : 'no differences',
  )
  return { lines, differences: differing.length }
}

/** One `gh api` call. gh holds the login, and its token never reaches this process. */
function gh(method: string, path: string, body?: Record<string, JsonValue>): ApiAnswer {
  const result = spawnSync(
    'gh',
    ['api', '--include', '--method', method, path.replace(/^\//, ''), ...(body ? ['--input', '-'] : [])],
    {
      input: body ? JSON.stringify(body) : undefined,
      encoding: 'utf8',
    },
  )
  if (result.error) throw new Error(`couldn't run gh: ${result.error.message}`)
  const [head = '', ...rest] = result.stdout.split(/\r?\n\r?\n/)
  const status = Number(/^HTTP\/[\d.]+ (\d{3})/.exec(head)?.[1] ?? 0)
  if (!status) throw new Error(`gh gave no HTTP status for ${method} ${path}: ${result.stderr.trim()}`)
  const text = rest.join('\n\n').trim()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status, body: parsed }
}

function readAll(target: Target): Answers {
  const answers = new Map<string, ApiAnswer>()
  for (const setting of DESIRED) {
    const path = pathFor(setting.read, target)
    if (!answers.has(path)) answers.set(path, gh('GET', path))
    const list = answers.get(path)
    if (setting.expect.kind !== 'ruleset' || !list || !ok2xx(list) || !Array.isArray(list.body)) continue
    for (const entry of list.body) {
      if (!isRecord(entry) || typeof entry.id !== 'number') continue
      const detailPath = `${path}/${entry.id}`
      if (!answers.has(detailPath)) answers.set(detailPath, gh('GET', detailPath))
    }
  }
  return answers
}

function rulesetFiles(): Record<string, JsonValue> {
  const files: Record<string, JsonValue> = {}
  for (const setting of DESIRED) {
    if (setting.expect.kind !== 'ruleset') continue
    const { name } = setting.expect
    const parsed: unknown = JSON.parse(
      readFileSync(new URL(`../../.github/rulesets/${name}.json`, import.meta.url), 'utf8'),
    )
    if (!isRecord(parsed)) throw new Error(`.github/rulesets/${name}.json isn't an object`)
    files[name] = parsed as JsonValue
  }
  return files
}

function check(target: Target, rulesets: Record<string, JsonValue>): Verdict[] {
  const verdicts = checkSettings(DESIRED, readAll(target), rulesets, target)
  const { lines } = report(verdicts)
  for (const line of lines) console.log(line)
  return verdicts
}

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { check: { type: 'boolean' }, apply: { type: 'boolean' }, repo: { type: 'string' } },
  })
  if (values.check === values.apply) {
    console.error('usage: node scripts/github/settings.ts --check|--apply [--repo owner/name]')
    return 2
  }
  const repo = values.repo ?? 'orhunakkan/agentic-library'
  const owner = /^([\w.-]+)\/[\w.-]+$/.exec(repo)?.[1]
  if (!owner) {
    console.error('--repo must be owner/name')
    return 2
  }
  const target = { repo, owner }
  const rulesets = rulesetFiles()
  const verdicts = check(target, rulesets)
  if (values.check) return verdicts.some((verdict) => verdict.state !== 'matches') ? 1 : 0
  for (const verdict of verdicts.filter((candidate) => candidate.state !== 'matches')) {
    const fix = fixFor(verdict, rulesets)
    if (typeof fix === 'string') {
      console.log(`by hand: ${verdict.setting.label}: ${fix}`)
      continue
    }
    for (const call of fix) {
      const answer = gh(call.method, pathFor(call.path, target), call.body)
      console.log(`${ok2xx(answer) ? 'set' : `failed (${answer.status})`}: ${verdict.setting.label}`)
    }
  }
  console.log('\nAfter applying:')
  return check(target, rulesets).some((verdict) => verdict.state !== 'matches') ? 1 : 0
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2))
