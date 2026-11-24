import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path/posix'
import { describe, expect, it } from 'vitest'

const ALLOWLIST: Record<string, string> = {
  'src/server/functions.ts': 'server functions: TanStack Start turns them into RPC calls, which the E2E specs make',
  'src/server/account-functions.ts': 'server functions for the account pages, called over RPC by the E2E specs',
  'src/shared/content/schema.ts': 'types only; nothing to run',
  'src/server/books/catalogue.ts': 'inside the books module: tested through openBook in books.db.test.ts (#88)',
  'src/server/books/private.ts': 'inside the books module: tested through openBook in books.db.test.ts (#88)',
  'src/server/books/views.ts': 'inside the books module: tested through openBook in books.db.test.ts (#88)',
  'src/shared/lookup/contract.ts': 'types only: the bodies and answers of the lookup routes; nothing to run',
  'src/client/lib/hue-classes.ts': 'a constant class map, there so Tailwind sees each class; the built CSS is E2E',
  'src/client/lib/use-media-query.ts': 'a React hook over matchMedia; the layout specs cover it in real browsers',
  'src/client/features/ask/use-ask.ts':
    'the React hook behind the Ask panel; its logic is in ask-client and thread-store',
  'src/client/features/ask-voice/use-ask-voice.ts':
    'the React hook behind Ask by voice; its logic is in voice-session and voice-turn; covered by ask-voice.spec',
  'src/client/features/highlights/use-highlights.ts': 'the React hook behind highlights; covered by highlights.spec',
  'src/client/features/bookmarks/use-bookmarks.ts':
    'the React hook behind bookmarks; its logic is in bookmark-list, bookmarks-client and shared/bookmarks; covered by bookmarks.spec',
  'src/client/features/ask-prompts/use-ask-prompts.ts':
    'the React wiring over prompt-store.ts and ask-prompts-client.ts; covered by ask-prompts.spec',
  'src/client/features/shelves/use-shelves.ts':
    'the React wiring over shelf-store.ts, shelf-list.ts and shelves-client.ts; covered by shelves.spec.ts',
  'src/client/features/github-repos/use-repos.ts':
    'the React hook over repos-client.ts, which is tested; covered by github-repos.spec',
  'src/client/features/admin/use-users.ts':
    'wiring only; the logic is in users-store.ts, admin-client.ts and shared/admin/users.ts; covered by users.spec.ts',
  'src/shared/shelves/contract.ts': 'types only: the bodies and answers of the shelves routes; nothing to run',
  'src/shared/flashcards/contract.ts': 'types only: the answers of the flashcards routes and reads; nothing to run',
  'src/shared/removed-books/contract.ts':
    'types only: the body and answers of the removed books route and its read; nothing to run',
  'src/client/features/lookup/use-lookup.ts':
    'the React hook behind the lookup card; its logic is in lookup-answers, lookup-client, lookup-prefs and shared/lookup; covered by lookup.spec',
  'src/client/features/bookmarks/use-audio-bookmarks.ts':
    'the React hook behind audio bookmarks; its logic is in audio-bookmark-list and shared/bookmarks/audio; covered by audio-bookmarks.spec',
  'src/client/features/reader/use-reader-prefs.ts': 'a React hook over prefs.ts and storage; covered by reader.spec',
  'src/client/features/highlights/paint.ts': 'paints with CSS.highlights, which only a browser has; highlights.spec',
  'src/client/features/read-aloud/use-read-aloud.ts': 'the React hook over controller.ts; covered by read-aloud.spec',
  'src/client/features/reading-stats/reading-time.ts':
    "wiring only; the rules are tracker.ts's and outbox.ts's; covered by reading-stats.spec",
  'src/client/features/sync/use-sync.ts':
    'the React hook that runs the sync layer; its logic is in engine, merge, outbox and local; covered by sync.spec',
  'src/client/features/offline/use-download.ts':
    'the React state behind Download for offline; its logic is in download.ts and store.ts; covered by offline.spec.ts',
  'src/client/features/install/use-install.ts':
    'wiring only; the logic is in install-offer.ts, unit-tested; the row is covered by pwa.spec.ts',
  'src/client/features/read-aloud/piper/piper.worker.ts':
    'runs only in a real browser with WASM; read-aloud-folio-real.spec.ts drives it',
  'src/client/features/read-aloud/piper/protocol.ts': 'types only: the messages to and from the Folio voice’s worker',
  'src/client/features/read-aloud/piper/piper-phonemize.d.ts': 'types only, for piper-wasm’s Emscripten build',
  'src/client/features/billing/use-checkout.ts':
    'the React hook that opens Paddle.js; its logic is in billing-client and confirm-wait, and Paddle.js only runs in a browser; covered by billing.spec.ts',
  'src/client/features/articles/readability.ts':
    'DOMParser and Readability, browser only (a DOM for Vitest would be a second dependency); its result goes through article-draft.ts, unit-tested; covered by articles.spec.ts',
  'src/client/features/run-code/use-runner.ts':
    'the React hook that owns the sandboxed iframe, which only a browser has; its logic is in the sandbox modules, run-messages and transpile, unit-tested; covered by run-code.spec.ts',
  'src/client/features/book-details/cover-image.ts':
    'canvas and createImageBitmap, browser only; its logic is fitWithin and checkCoverImage in shared/import/image.ts; covered by book-details.spec and import.spec',
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
  const tests = ['src', 'tests', 'scripts'].flatMap(filesUnder).filter((f) => f.endsWith('.test.ts'))
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

const modules = ['src/server', 'src/shared', 'src/client']
  .flatMap(filesUnder)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('src/server/testing/'))
  .sort()
const imported = importedByTests()
const isImported = (file: string) => imported.has(file.replace(/\.ts$/, ''))

describe('every module is tested', () => {
  it('finds the modules and the tests it checks', () => {
    expect(modules.length).toBeGreaterThan(50)
    expect(isImported('src/shared/import/paginate.ts')).toBe(true)
  })

  it('has a test that imports each module, or an allowlist entry saying why not', () => {
    const untested = modules.filter((file) => !isImported(file) && !(file in ALLOWLIST))
    expect(untested, 'Add a *.test.ts that imports these, or (with a reason) an ALLOWLIST entry').toEqual([])
  })

  it('has no stale allowlist entries', () => {
    const stale = Object.keys(ALLOWLIST).filter((file) => !modules.includes(file) || isImported(file))
    expect(stale, 'These are gone or tested now: remove them from ALLOWLIST').toEqual([])
  })

  it('gives every allowlist entry a reason', () => {
    expect(Object.entries(ALLOWLIST).filter(([, reason]) => reason.trim().length < 10)).toEqual([])
  })
})
