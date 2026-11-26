import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path/posix'
import { describe, expect, it } from 'vitest'

const ALLOWLIST: Record<string, string> = {
  'src/server/functions.ts': 'server functions: TanStack Start turns them into RPC calls; no test runs it',
  'src/server/account-functions.ts': 'server functions for the account pages, called over RPC; no test runs it',
  'src/shared/content/schema.ts': 'types only; nothing to run',
  'src/server/books/catalogue.ts':
    'inside the books module: tested through openBook in books.integration.test.ts (#88)',
  'src/server/books/private.ts': 'inside the books module: tested through openBook in books.integration.test.ts (#88)',
  'src/server/books/views.ts': 'inside the books module: tested through openBook in books.integration.test.ts (#88)',
  'src/shared/lookup/contract.ts': 'types only: the bodies and answers of the lookup routes; nothing to run',
  'src/client/lib/hue-classes.ts': 'a constant class map, there so Tailwind sees each class; nothing to run',
  'src/shared/flashcards/contract.ts': 'types only: the answers of the flashcards routes and reads; nothing to run',
  'src/shared/removed-books/contract.ts':
    'types only: the body and answers of the removed books route and its read; nothing to run',
  'src/client/features/highlights/paint.ts': 'paints with CSS.highlights, which only a browser has; no test runs it',
  'src/client/features/read-aloud/browser-read-aloud.ts':
    "the browser's speech engines and server calls handed to the player, whose rules player.test covers; no test runs it",
  'src/client/features/reading-stats/reading-time.ts':
    "wiring only; the rules are tracker.ts's and outbox.ts's; no test runs it",
  'src/client/features/read-aloud/piper/piper.worker.ts': 'runs only in a real browser with WASM; no test runs it',
  'src/client/features/read-aloud/piper/protocol.ts': 'types only: the messages to and from the Folio voice’s worker',
  'src/client/features/read-aloud/piper/piper-phonemize.d.ts': 'types only, for piper-wasm’s Emscripten build',
  'src/client/features/articles/readability.ts':
    'DOMParser and Readability, browser only (a DOM for Vitest would be a second dependency); its result goes through article-draft.ts, unit-tested; no test runs it',
  'src/client/features/book-details/cover-image.ts':
    'canvas and createImageBitmap, browser only; its logic is fitWithin and checkCoverImage in shared/import/image.ts; no test runs it',
}

const STATIC_IMPORT = /^[ \t]*(?:import|export)\s+(type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /(typeof\s+)?\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath.replaceAll('\\', '/'), entry.name))
}

function resolveImport(fromFile: string, specifier: string): string | null {
  let target: string
  if (specifier.startsWith('~/')) target = `src/${specifier.slice(2)}`
  else if (specifier.startsWith('./') || specifier.startsWith('../')) target = join(dirname(fromFile), specifier)
  else return null
  return normalize(target)
    .replace(/\?.*$/, '')
    .replace(/\.(ts|tsx)$/, '')
}

function importedByTests(): Set<string> {
  const tests = ['src', 'tests', 'scripts'].flatMap(filesUnder).filter((f) => /\.test\.tsx?$/.test(f))
  const imported = new Set<string>()
  for (const file of tests) {
    const source = readFileSync(file, 'utf8')
    const specifiers = [
      ...[...source.matchAll(STATIC_IMPORT)].filter((m) => !m[1]).map((m) => m[2] ?? ''),
      ...[...source.matchAll(DYNAMIC_IMPORT)].filter((m) => !m[1]).map((m) => m[2] ?? ''),
    ]
    for (const specifier of specifiers) {
      const target = resolveImport(file, specifier)
      if (target) imported.add(target)
    }
  }
  return imported
}

/** Helpers that only tests use, like src/server/testing's fixtures and src/client/testing's mount. */
const TEST_HELPERS = ['src/server/testing/', 'src/client/testing/']

const modules = ['src/server', 'src/shared', 'src/client']
  .flatMap(filesUnder)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !TEST_HELPERS.some((dir) => f.startsWith(dir)))
  .sort()
const imported = importedByTests()
const isImported = (file: string) => imported.has(file.replace(/\.ts$/, ''))

describe('every module is tested', () => {
  it('finds the modules and the tests it checks', () => {
    expect(modules.length).toBeGreaterThan(50)
    expect(isImported('src/shared/import/paginate.ts')).toBe(true)
  })

  it('counts imports from component tests (*.test.tsx) too', () => {
    expect(isImported('src/client/testing/mount.ts'), 'only the *.browser.test.tsx files import it').toBe(true)
  })

  it('has a test that imports each module, or an allowlist entry saying why not', () => {
    const untested = modules.filter((file) => !isImported(file) && !(file in ALLOWLIST))
    expect(untested, 'Add a *.test.ts or *.test.tsx that imports these, or (with a reason) an ALLOWLIST entry').toEqual(
      [],
    )
  })

  it('has no stale allowlist entries', () => {
    const stale = Object.keys(ALLOWLIST).filter((file) => !modules.includes(file) || isImported(file))
    expect(stale, 'These are gone or tested now: remove them from ALLOWLIST').toEqual([])
  })

  it('gives every allowlist entry a reason', () => {
    expect(Object.entries(ALLOWLIST).filter(([, reason]) => reason.trim().length < 10)).toEqual([])
  })
})
