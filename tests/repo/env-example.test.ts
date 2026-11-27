import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Keeps `.env.example` in step with the code: it lists exactly the settings the server reads, every secret in it is
 * empty, and no line holds a value shaped like a real key.
 */

/**
 * Where the server and its operator scripts read settings. Tests, their helpers in `tests/support/` and stubs read
 * others, such as Vitest's `VITEST_POOL_ID`, which don't belong here.
 */
const SETTING_SOURCES = ['src/server/**/*.ts', 'scripts/serve.ts', 'scripts/db/*.ts']
/** `env.NAME` and `env['NAME']`, which is how the server reads settings, from process.env or the env it's given. */
const READ = /\benv(?:\.([A-Z][A-Z0-9_]*)\b|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g
const LISTED = /^#?\s*([A-Z][A-Z0-9_]*)=(.*)$/gm
/**
 * Not settings: `USER` and `USERNAME` are operating-system variables that the scripts write to the audit log, and
 * systemd sets `CREDENTIALS_DIRECTORY` for its credentials, which the Encryption group's comment explains.
 */
const NOT_SETTINGS = new Set(['USER', 'USERNAME', 'CREDENTIALS_DIRECTORY'])
const SECRETS = ['KEK', 'KEK_PREVIOUS', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'GITHUB_TOKEN']
/** Shapes of real keys: Resend, GitHub fine-grained and classic tokens, Svix webhook secrets, and sk- API keys. */
const KEY_SHAPED = /\b(re_[A-Za-z0-9]{6,}|github_pat_\w{10,}|gh[pousr]_\w{20,}|whsec_[A-Za-z0-9+/]{8,}|sk-[\w-]{10,})/

function settingsReadByCode(): Set<string> {
  const sources = SETTING_SOURCES.flatMap((pattern) => globSync(pattern)).filter((file) => !file.endsWith('.test.ts'))
  const names = sources.flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(READ)].map(([, dotted, indexed]) => dotted ?? indexed),
  )
  return new Set(names.filter((name): name is string => name !== undefined && !NOT_SETTINGS.has(name)))
}

/** Each way `exampleText` disagrees with the settings `read` by the code, naming the setting. */
function envExampleProblems(exampleText: string, read: ReadonlySet<string>): string[] {
  const entries = [...exampleText.matchAll(LISTED)].map(([line = '', name = '', value = '']) => ({ line, name, value }))
  const listed = new Set(entries.map((entry) => entry.name))
  return [
    ...[...read].filter((name) => !listed.has(name)).map((name) => `${name} is read by the server but missing`),
    ...[...listed].filter((name) => !read.has(name)).map((name) => `${name} is listed but read nowhere`),
    ...entries
      .filter((entry) => SECRETS.includes(entry.name) && entry.value.trim() !== '')
      .map((entry) => `${entry.name} is a secret, and must be empty`),
    ...exampleText
      .split('\n')
      .filter((line) => KEY_SHAPED.test(line))
      .map((line) => `a line holds a value shaped like a real key: ${line.slice(0, 40)}`),
  ]
}

const EXAMPLE = () => readFileSync('.env.example', 'utf8')

describe('.env.example', () => {
  it('lists every setting the server reads, and nothing else, with every secret empty', () => {
    expect(envExampleProblems(EXAMPLE(), settingsReadByCode())).toEqual([])
  })

  it('finds the settings the code reads, including the ones only scripts read', () => {
    const read = settingsReadByCode()
    for (const name of ['DATABASE_URL', 'KEK', 'SOURCE_URL', 'LIMIT_ARTICLE_TEXT', 'HOST', 'DB_OWNER_ROLE', 'NODE_ENV'])
      expect(read.has(name), name).toBe(true)
    for (const name of NOT_SETTINGS) expect(read.has(name), name).toBe(false)
  })
})

describe('envExampleProblems', () => {
  const READ_HERE = new Set(['DATABASE_URL', 'KEK', 'LIMIT_BOOKS'])
  const GOOD = '# Database\nDATABASE_URL=postgres://x\nKEK=\n# LIMIT_BOOKS=25\n'

  it('passes a file that lists exactly what is read', () => {
    expect(envExampleProblems(GOOD, READ_HERE)).toEqual([])
  })

  it('names a setting that is read but missing, commented or not', () => {
    expect(envExampleProblems(GOOD.replace('# LIMIT_BOOKS=25\n', ''), READ_HERE)).toEqual([
      'LIMIT_BOOKS is read by the server but missing',
    ])
  })

  it('names a setting that is listed but read nowhere', () => {
    expect(envExampleProblems(`${GOOD}# LIMIT_SHELVES=10\n`, READ_HERE)).toEqual([
      'LIMIT_SHELVES is listed but read nowhere',
    ])
  })

  it('names a secret with a value, and a value shaped like a real key', () => {
    expect(envExampleProblems(GOOD.replace('KEK=', 'KEK=abc'), READ_HERE)).toEqual([
      'KEK is a secret, and must be empty',
    ])
    const leaked = envExampleProblems(`${GOOD}# Example: re_${'a1b2'.repeat(4)}\n`, READ_HERE)
    expect(leaked).toHaveLength(1)
    expect(leaked[0]).toMatch(/^a line holds a value shaped like a real key/)
  })
})
