import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * Keeps the contributor docs true to the repo (spec/SPEC-contributor-docs.md, section 8): their relative links point to
 * files that exist, every `pnpm <name>` they show is a real script, the licence is MIT, the local Postgres is pinned
 * by digest and bound to localhost, and no billing word comes back.
 */

const DOCS = ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', '.github/pull_request_template.md']
const ISSUE_FORMS = ['config.yml', 'bug_report.yml', 'feature_request.yml'].map(
  (name) => `.github/ISSUE_TEMPLATE/${name}`,
)
/** pnpm's own commands that the docs may show, beside the package's scripts. */
const PNPM_COMMANDS = new Set(['install', 'exec', 'dlx'])
/** `Pro` as a capitalised plan name only; the rest in any case. */
const BILLING_WORDS = [/\b(Paddle|Pro)\b/, /\b(pricing|prices?|subscriptions?)\b/i]

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

const read = (file: string) => readFileSync(file, 'utf8')

function packageJson(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(read('package.json'))
  if (!isRecord(parsed)) throw new Error('package.json is not an object')
  return parsed
}

function scriptNames(): Set<string> {
  const scripts = packageJson().scripts
  return new Set(isRecord(scripts) ? Object.keys(scripts) : [])
}

/** Relative links in a Markdown file that point to nothing, resolved from the file's own folder. */
function brokenLinks(
  file: string,
  text: string,
  exists: (path: string) => boolean,
  readFile: (path: string) => string = read,
): string[] {
  const targets = [...text.matchAll(/\]\(([^)\s]+)\)|^\[[^\]]+\]:\s*(\S+)/gm)].map(
    ([, inline, reference]) => inline ?? reference ?? '',
  )
  return targets
    .filter((target) => target && !/^([a-z][a-z+.-]*:|#)/i.test(target))
    .flatMap((target) => {
      const [path = '', anchor] = target.split('#')
      const full = join(dirname(file), path)
      if (!exists(full)) return [`${file} links ${path}, which doesn't exist`]
      if (anchor && full.endsWith('.md') && !headingAnchors(readFile(full)).has(anchor))
        return [`${file} links ${path}#${anchor}, a heading that doesn't exist`]
      return []
    })
}

/** The anchors GitHub gives a Markdown file's headings: lower case, spaces as hyphens, other punctuation dropped. */
function headingAnchors(text: string): Set<string> {
  const headings = [...text.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map(([, heading]) => heading ?? '')
  return new Set(
    headings.map((heading) =>
      heading
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s/g, '-'),
    ),
  )
}

/** Each `pnpm <name>` in the file's code, inline or in blocks, that is neither a script nor one of pnpm's commands. */
function unknownScripts(file: string, text: string, scripts: ReadonlySet<string>): string[] {
  const code = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g)].map(
    ([, block, inline]) => block ?? inline ?? '',
  )
  const names = code.flatMap((snippet) => [...snippet.matchAll(/\bpnpm ([a-z][\w:-]*)/g)].map(([, name]) => name ?? ''))
  return [...new Set(names)]
    .filter((name) => !scripts.has(name) && !PNPM_COMMANDS.has(name))
    .map((name) => `${file} shows pnpm ${name}, which isn't a script in package.json`)
}

function billingWords(file: string, text: string): string[] {
  return text
    .split('\n')
    .filter((line) => BILLING_WORDS.some((words) => words.test(line)))
    .map((line) => `${file} mentions billing: ${line.trim().slice(0, 60)}`)
}

/** The `@sha256:` digest of the postgres image in a compose file, or null. */
const postgresDigest = (text: string) => /image:\s*postgres:[\w.-]+@(sha256:[0-9a-f]{64})/.exec(text)?.[1] ?? null

function composeProblems(composeText: string): string[] {
  const problems: string[] = []
  if (!postgresDigest(composeText)) problems.push('compose.yaml: postgres is not pinned by @sha256:')
  const compose: unknown = parse(composeText)
  const services = isRecord(compose) && isRecord(compose.services) ? compose.services : {}
  for (const [name, service] of Object.entries(services)) {
    const ports = isRecord(service) && Array.isArray(service.ports) ? service.ports : []
    for (const port of ports)
      if (typeof port !== 'string' || !port.startsWith('127.0.0.1:'))
        problems.push(`compose.yaml: ${name} publishes ${JSON.stringify(port)}, not on 127.0.0.1`)
  }
  return problems
}

describe('the contributor docs', () => {
  it.each(DOCS)('%s links only to files that exist', (file) => {
    expect(brokenLinks(file, read(file), existsSync)).toEqual([])
  })

  it.each(DOCS)('%s shows only pnpm scripts that exist', (file) => {
    expect(unknownScripts(file, read(file), scriptNames())).toEqual([])
  })

  it.each([...DOCS, ...ISSUE_FORMS, '.env.example'])('%s never mentions billing', (file) => {
    expect(billingWords(file, read(file))).toEqual([])
  })

  it('show the licence as MIT, in package.json and LICENSE', () => {
    expect(packageJson().license).toBe('MIT')
    expect(packageJson().private).toBe(true)
    const licence = read('LICENSE')
    expect(licence.startsWith('MIT License\n')).toBe(true)
    expect(licence).toContain('\nCopyright (c) 2026 Orhun Akkan\n')
  })

  it('pin the local Postgres by digest, bound to 127.0.0.1 only', () => {
    expect(composeProblems(read('compose.yaml'))).toEqual([])
  })

  it.each(ISSUE_FORMS)('%s parses as YAML', (file) => {
    expect(isRecord(parse(read(file)))).toBe(true)
  })

  it('turn off blank issues, and offer the three contact links', () => {
    const config: unknown = parse(read('.github/ISSUE_TEMPLATE/config.yml'))
    expect(isRecord(config) && config.blank_issues_enabled).toBe(false)
    const links = isRecord(config) && Array.isArray(config.contact_links) ? config.contact_links : []
    expect(links.map((link) => (isRecord(link) ? link.url : null))).toEqual([
      'https://github.com/orhunakkan/agentic-library/security/advisories/new',
      'https://agenticlibrary.app/copyright',
      'https://agenticlibrary.app/privacy',
    ])
  })
})

describe('each check fails on a doc that drifted', () => {
  it('names a broken relative link, and ignores web links and anchors', () => {
    const text =
      'See [docs](docs/missing.md), [the guide](CONTRIBUTING.md#setup), [site](https://x.org) and [top](#top).'
    expect(brokenLinks('README.md', text, existsSync)).toEqual(["README.md links docs/missing.md, which doesn't exist"])
    expect(brokenLinks('.github/x.md', '[c](../CONTRIBUTING.md)\n[ref]: ../nowhere.md', existsSync)).toEqual([
      ".github/x.md links ../nowhere.md, which doesn't exist",
    ])
  })

  it('names a link to a heading that doesn’t exist, and finds the ones that do', () => {
    expect(brokenLinks('README.md', '[s](CONTRIBUTING.md#setup) [q](README.md#quick-start)', existsSync)).toEqual([])
    expect(brokenLinks('README.md', '[n](CONTRIBUTING.md#nope)', existsSync)).toEqual([
      "README.md links CONTRIBUTING.md#nope, a heading that doesn't exist",
    ])
  })

  it('names a pnpm script that package.json doesn’t have', () => {
    const text = 'Run `pnpm check`, then:\n\n```sh\npnpm install\npnpm test:e2e\n```\n'
    expect(unknownScripts('README.md', text, new Set(['check']))).toEqual([
      "README.md shows pnpm test:e2e, which isn't a script in package.json",
    ])
  })

  it('names an unpinned or non-loopback compose file', () => {
    expect(composeProblems('services:\n  postgres:\n    image: postgres:18\n')).toEqual([
      'compose.yaml: postgres is not pinned by @sha256:',
    ])
    const pinned = `services:\n  postgres:\n    image: postgres:18@sha256:${'0'.repeat(64)}\n    ports: ["5432:5432"]\n`
    expect(composeProblems(pinned)).toEqual(['compose.yaml: postgres publishes "5432:5432", not on 127.0.0.1'])
  })

  it('names a billing word, and leaves words that only start like one alone', () => {
    expect(billingWords('README.md', 'Upgrade to Pro for more.\nPay through Paddle.\nProjects and providers.')).toEqual(
      ['README.md mentions billing: Upgrade to Pro for more.', 'README.md mentions billing: Pay through Paddle.'],
    )
  })
})
