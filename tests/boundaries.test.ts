import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path/posix'
import { describe, expect, it } from 'vitest'

type Area = 'client' | 'server' | 'shared' | 'routes'

interface ImportRef {
  specifier: string
  typeOnly: boolean
}

const SERVER_FUNCTION_MODULES = ['src/server/functions', 'src/server/account-functions']

/** Integration tests that drive a client module against the real handlers in-process, to check both sides agree (#92). */
const AGREEMENT_TESTS = ['src/server/shelves/shelves-client.integration.test.ts']

const STATIC_IMPORT = /^[ \t]*(?:import|export)\s+(type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function importsOf(source: string): ImportRef[] {
  const found: ImportRef[] = []
  for (const match of source.matchAll(STATIC_IMPORT)) {
    found.push({ specifier: match[2] ?? '', typeOnly: match[1] !== undefined })
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT)) found.push({ specifier: match[1] ?? '', typeOnly: false })
  return found
}

function resolveImport(fromFile: string, specifier: string): string | null {
  let target: string
  if (specifier.startsWith('~/')) target = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('./') || specifier.startsWith('../')) target = join(dirname(fromFile), specifier)
  else return null
  target = normalize(target)
    .replace(/\?.*$/, '')
    .replace(/\.(ts|tsx)$/, '')
  return target.startsWith('src/') ? target : null
}

function areaOf(path: string): Area | null {
  const match = /^src\/(client|server|shared|routes)\//.exec(path)
  return match ? (match[1] as Area) : null
}

function violation(fromFile: string, ref: ImportRef): string | null {
  const from = areaOf(fromFile)
  const target = resolveImport(fromFile, ref.specifier)
  const to = target ? areaOf(target) : null
  if (!from || !target || !to || from === to) return null
  if (from === 'shared' && (to === 'client' || to === 'server' || to === 'routes')) {
    return `shared code imports ${to} code`
  }
  if (from === 'server' && to === 'client' && AGREEMENT_TESTS.includes(fromFile)) return null
  if (from === 'server' && (to === 'client' || to === 'routes')) return `server code imports ${to} code`
  if (from === 'client' && to === 'server' && !ref.typeOnly && !SERVER_FUNCTION_MODULES.includes(target)) {
    return 'client code imports a server module that is not a server-function module'
  }
  return null
}

function boundaryViolations(files: { path: string; source: string }[]): string[] {
  return files.flatMap(({ path, source }) =>
    importsOf(source).flatMap((ref) => {
      const why = violation(path, ref)
      return why ? [`${path} → ${ref.specifier} (${why})`] : []
    }),
  )
}

function sourcesUnder(dir: string): { path: string; source: string }[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => `${dir}/${name.replaceAll('\\', '/')}`)
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
}

describe('importsOf', () => {
  it('finds static, multi-line, re-export, side-effect and dynamic imports', () => {
    const source = [
      "import { a } from '~/shared/lib/site'",
      'import {',
      '  b,',
      '  type C,',
      "} from './b'",
      "import type { D } from '../d'",
      "export { e } from './e'",
      "export type { F } from './f'",
      "export * from './g'",
      "import '@tanstack/react-start/server-only'",
      "const h = await import('~/server/db')",
    ].join('\n')
    expect(importsOf(source)).toEqual([
      { specifier: '~/shared/lib/site', typeOnly: false },
      { specifier: './b', typeOnly: false },
      { specifier: '../d', typeOnly: true },
      { specifier: './e', typeOnly: false },
      { specifier: './f', typeOnly: true },
      { specifier: './g', typeOnly: false },
      { specifier: '@tanstack/react-start/server-only', typeOnly: false },
      { specifier: '~/server/db', typeOnly: false },
    ])
  })
})

describe('resolveImport', () => {
  it('resolves the alias and relative paths, and ignores packages and anything outside src/', () => {
    expect(resolveImport('src/client/a.ts', '~/server/db.ts')).toBe('src/server/db')
    expect(resolveImport('src/client/styles/x.ts', '~/client/styles/app.css?url')).toBe('src/client/styles/app.css')
    expect(resolveImport('src/shared/content/a.ts', '../../server/db.ts')).toBe('src/server/db')
    expect(resolveImport('src/shared/content/a.ts', './schema')).toBe('src/shared/content/schema')
    expect(resolveImport('src/server/a.ts', '../../tests/fixtures/books')).toBeNull()
    expect(resolveImport('src/server/a.ts', 'postgres')).toBeNull()
  })
})

describe('violation', () => {
  const value = (specifier: string): ImportRef => ({ specifier, typeOnly: false })
  const typeOnly = (specifier: string): ImportRef => ({ specifier, typeOnly: true })

  it('allows imports within a side and into shared', () => {
    expect(violation('src/client/features/reader/Reader.tsx', value('./prefs'))).toBeNull()
    expect(violation('src/client/components/BookCard.tsx', value('~/shared/content/library'))).toBeNull()
    expect(violation('src/server/repository.ts', value('~/shared/content/schema'))).toBeNull()
  })

  it('rejects shared code importing client, server or routes code', () => {
    expect(violation('src/shared/content/a.ts', value('~/client/lib/cn'))).toMatch(/shared code imports client/)
    expect(violation('src/shared/content/a.ts', value('~/server/db'))).toMatch(/shared code imports server/)
    expect(violation('src/shared/content/a.ts', value('~/routes/__root'))).toMatch(/shared code imports routes/)
    expect(violation('src/shared/content/a.ts', typeOnly('~/server/users'))).toMatch(/shared code imports server/)
  })

  it('rejects server code importing client or routes code', () => {
    expect(violation('src/server/og.ts', value('~/client/lib/cn'))).toMatch(/server code imports client/)
    expect(violation('src/server/og.ts', value('~/routes/og'))).toMatch(/server code imports routes/)
  })

  it('lets a named agreement test drive a client module against its handlers, and nothing else', () => {
    const client = value('~/client/features/shelves/shelves-client')
    expect(violation('src/server/shelves/shelves-client.integration.test.ts', client)).toBeNull()
    expect(violation('src/server/shelves/shelves.integration.test.ts', client)).toMatch(/server code imports client/)
    expect(violation('src/server/shelves/shelves-client.integration.test.ts', value('~/routes/og'))).toMatch(
      /server code imports routes/,
    )
  })

  it('rejects client value imports of server modules, except the server-function modules', () => {
    expect(violation('src/client/features/a.ts', value('~/server/db'))).toMatch(/not a server-function module/)
    expect(violation('src/client/features/a.ts', value('~/server/functions'))).toBeNull()
    expect(violation('src/client/features/a.ts', value('~/server/account-functions'))).toBeNull()
  })

  it('allows type-only imports of any server module from client code', () => {
    expect(violation('src/client/features/a.ts', typeOnly('~/server/ask/stream'))).toBeNull()
  })

  it('follows a relative path that climbs out of its folder', () => {
    expect(violation('src/shared/import/a.ts', value('../../server/db.ts'))).toMatch(/shared code imports server/)
    expect(violation('src/client/lib/a.ts', value('../../server/users.ts'))).toMatch(/not a server-function module/)
  })
})

describe('the source tree', () => {
  it('keeps client, server and shared code within their boundaries', () => {
    const files = ['src/client', 'src/server', 'src/shared'].flatMap(sourcesUnder)
    expect(files.length).toBeGreaterThan(100)
    expect(boundaryViolations(files)).toEqual([])
  })
})
