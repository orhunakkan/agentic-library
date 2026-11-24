import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface Seam {
  name: string
  pattern: RegExp
  under: string[]
  /** Scan test files too; by default a seam guards only shipped source. */
  tests?: boolean
  allowed: Record<string, string>
}

const SEAMS: Seam[] = [
  {
    name: "a book slug's u- prefix is written only by the book slug codec (#87)",
    pattern: /(^|[^a-zA-Z0-9_-])u-/m,
    under: ['src/client', 'src/server', 'src/shared', 'src/routes'],
    allowed: { 'src/shared/content/book-slug.ts': 'the codec' },
  },
  {
    name: 'a test builds a private book slug with the codec, never by hand (#87)',
    pattern: /u-(\$\{|[0-9a-f]{8}-)/,
    under: ['src', 'tests/fixtures', 'tests/content.test.ts'],
    tests: true,
    allowed: {
      'src/shared/content/book-slug.test.ts': "the codec's own round-trips",
      'src/shared/uuid.test.ts': 'a slug is not a UUID',
    },
  },
  {
    name: 'a book ref is built only by the book slug codec, or by bookOf from a row, in tests too (#88)',
    pattern: /\{ slug: [^,{}]+, userBookId: [^,{}]+ \}/,
    under: ['src'],
    tests: true,
    allowed: {
      'src/shared/content/book-slug.ts': 'the codec (refFor)',
      'src/server/books/ref.ts': 'bookOf, from a row',
      'src/shared/content/book-slug.test.ts': "the codec's own round-trips",
      'src/server/books/ref.test.ts': "bookOf's own round-trips",
    },
  },
  {
    name: 'the catalogue is searched for a book only by repository.ts (#70)',
    pattern: /\.books\.(find|some)\(/,
    under: ['src/server'],
    allowed: {},
  },
  {
    name: "an owned book's ready check is written only where books are stored and in the books module (#70)",
    pattern: /status = 'ready'/,
    under: ['src/server'],
    allowed: {
      'src/server/user-books.ts': 'private books themselves',
      'src/server/audiobooks/store.ts': 'an audiobook import',
      'src/server/book-details/store.ts': "a book's details",
      'src/server/book-images/store.ts': "a book's pictures",
      'src/server/books/book.ts': 'the one 404 rule (ownedBook, onReadableBook)',
    },
  },
  {
    name: "no feature imports highlights' store or input; the book reference is the books module's (#70)",
    pattern: /['"][^'"]*highlights\/(store|input)(\.ts)?['"]/,
    under: ['src/client', 'src/server', 'src/shared', 'src/routes'],
    allowed: {},
  },
  {
    name: "a book no longer in the library is named only by the books module's labels (#70)",
    pattern: /no longer in the library/,
    under: ['src/server'],
    allowed: { 'src/server/books/book.ts': 'labelsFor' },
  },
  {
    name: 'only the gate checks who is signed in on a JSON endpoint (#71)',
    pattern: /if \(!who\.ok\)/,
    under: ['src/server'],
    allowed: { 'src/server/signed-in.ts': 'the gate' },
  },
  {
    name: 'only the gate and the signed-out passkey sign-in read a JSON body themselves (#71)',
    pattern: /\b(PROBLEM_STATUS|readJsonBody)\b/,
    under: ['src/server'],
    allowed: {
      'src/server/json-body.ts': 'defines them',
      'src/server/signed-in.ts': 'the gate',
      'src/server/passkeys/sign-in.ts': 'signed out, so outside the gate',
    },
  },
  {
    name: "a handler's error answer comes from its gate group, not a local fail (#71)",
    pattern: /const fail\b[^\n]*noStoreJson/,
    under: ['src/server'],
    allowed: {
      'src/server/signed-in.ts': 'the gate',
      'src/server/passkeys/sign-in.ts': 'signed out, so outside the gate',
    },
  },
  {
    name: 'the session lookups are called only through the gate (#71)',
    pattern: /\b(signedInCaller|apiCaller)\b/,
    under: ['src/client', 'src/server', 'src/shared', 'src/routes'],
    allowed: { 'src/server/auth.ts': 'defines them', 'src/server/signed-in.ts': 'the gate' },
  },
  {
    name: "only the form gate sends a signed-in form's signed-out reader to sign in (#76)",
    pattern: /seeOther\(loginHref\(/,
    under: ['src/server'],
    allowed: {
      'src/server/signed-in.ts': 'the gate',
      'src/server/email/actions.ts':
        'confirming an address: the way back names the token in its form, and a broken link answers before the session',
    },
  },
  {
    name: 'a form post checks its origin itself only where it is posted signed out (#76)',
    pattern: /\bisSameOrigin\(/,
    under: ['src/server'],
    allowed: {
      'src/server/security.ts': 'defines it',
      'src/server/auth.ts': "the gates' callers",
      'src/server/account-actions.ts': 'sign-in and sign-out',
      'src/server/email/actions.ts': 'forgot and reset password, and confirming an address (above)',
      'src/server/signup/actions.ts': 'sign-up',
      'src/server/passkeys/sign-in.ts': 'passkey sign-in',
    },
  },
  {
    name: 'only the form gate and the signed-out forms read a form body (#76)',
    pattern: /\breadForm\(/,
    under: ['src/server'],
    allowed: {
      'src/server/json-body.ts': 'defines it',
      'src/server/signed-in.ts': 'the gate, with its cap',
      'src/server/account-actions.ts': 'sign-in',
      'src/server/email/actions.ts': 'forgot and reset password, and confirming an address (above)',
      'src/server/signup/actions.ts': 'sign-up',
    },
  },
  {
    name: "why the Reader's route changed lives in navigation-intent.ts, never in module state (#72)",
    pattern: /^(export )?(let|var) /m,
    under: [
      'src/client/features/reader/Reader.tsx',
      'src/client/features/reader/ScrollColumn.tsx',
      'src/client/features/reader/scroll-column.ts',
      'src/client/features/reader/navigation-intent.ts',
    ],
    allowed: {},
  },
  {
    name: 'only media-session.ts sets the lock screen, from what plays now (#77)',
    pattern: /\b(mediaSession|MediaMetadata)\b/,
    under: ['src/client', 'src/shared', 'src/routes'],
    allowed: { 'src/client/features/player/media-session.ts': 'the lock screen' },
  },
  {
    name: 'nothing reads or writes the retired starter book columns, users.starter_book_at and user_books.starter (#80)',
    pattern: /\bstarter_book_at\b|\bstarter\b/,
    under: ['src/server', 'scripts'],
    allowed: {},
  },
  {
    name: 'a lowercase UUID is checked only by isUuid in src/shared/uuid.ts (#85)',
    pattern: /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/,
    under: ['src'],
    allowed: {
      'src/shared/uuid.ts': 'defines isUuid',
      'src/server/sync/input.ts': 'accepts uppercase too (the i flag), so it is not the same check',
    },
  },
  {
    name: "a user's usage is checked against its limit only by the quota module, which takes the unit (#89)",
    pattern: /\b(nextAllowedAt|charactersRetryAt|usageSince)\(/,
    under: ['src/server'],
    allowed: {
      'src/server/rate-limit.ts': 'the arithmetic itself',
      'src/server/quota.ts': 'take, and the import check under its lock',
      'src/server/speech/store.ts': 'defines usageSince over the speech usage table',
      'src/server/articles/pacing.ts': 'in-memory pacing of outbound fetches, not a quota on users',
      'src/server/github-repos/pacing.ts': 'in-memory pacing of outbound GitHub calls, not a quota on users',
    },
  },
  {
    name: 'a test reaches a usage-quota limit through take (testing/quota.ts spend), never by writing its events (#89)',
    pattern:
      /(recordEvent\([^,]+, |insert into audit_events[^`]*)'(book\.asked|word\.(looked_up|translated)|book\.looked_up|repo\.(added|refreshed)|account\.exported|api_key\.(saved|deleted|rejected))'/,
    under: ['src/server'],
    tests: true,
    allowed: { 'src/server/quota.db.test.ts': "take's own test: a kind counts every event it names" },
  },
  {
    name: 'only the player module creates the arbiter, the audiobook transport and read aloud (#90)',
    pattern: /(?<!function )\bcreate(Arbiter|Transport|ReadAloud)\(/,
    under: ['src/client', 'src/routes'],
    allowed: { 'src/client/features/player/player.ts': 'the player module' },
  },
  {
    name: "the player names its sources 'read-aloud' and 'audiobook', from the glossary (#90)",
    pattern: /source(:| ===) '(audio|speech)'/,
    under: ['src/client/features/player'],
    tests: true,
    allowed: {},
  },
  {
    name: 'a reader href is parsed only by the position module (#91)',
    pattern: /\\\/read\\\//,
    under: ['src/client', 'src/server', 'src/shared', 'src/routes'],
    allowed: { 'src/shared/content/position.ts': 'the position module' },
  },
  {
    name: 'a position is told apart from a printed page only by the position module, or where the book kind decides (#91)',
    pattern: /'printedPage' in (position|a|b|value)\b/,
    under: ['src/client', 'src/server', 'src/shared', 'src/routes'],
    allowed: {
      'src/shared/content/position.ts': 'the position module',
      'src/server/ask/context.ts': 'pageIndexAt: a printed page is found only in a paged book',
      'src/server/sync/places.ts': "find: a private book's outline has no printed pages",
    },
  },
]

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

function sourcesUnder(path: string, tests = false): string[] {
  const kept = (file: string) => tests || !/\.test\.tsx?$/.test(file)
  if (/\.tsx?$/.test(path)) return kept(path) ? [path] : []
  return readdirSync(path, { recursive: true, encoding: 'utf8' })
    .map((name) => `${path}/${name.replaceAll('\\', '/')}`)
    .filter((file) => /\.tsx?$/.test(file) && kept(file))
}

function seamProblems(seam: Seam, read: (path: string) => string, files: string[]): string[] {
  const matching = files.filter((file) => seam.pattern.test(withoutComments(read(file))))
  const strays = matching.filter((file) => !(file in seam.allowed)).map((file) => `${file} matches`)
  const stale = Object.keys(seam.allowed)
    .filter((file) => !matching.includes(file))
    .map((file) => `${file} is allowed but no longer matches: take it off the list`)
  return [...strays, ...stale]
}

describe('withoutComments', () => {
  it('drops line and block comments and keeps URLs in strings', () => {
    const source = [
      '/** A book no longer in the library. */',
      "const a = 'https://example.test' // no longer in the library",
      '  // if (!who.ok)',
      "const b = 'x'",
    ].join('\n')
    const code = withoutComments(source)
    expect(code).not.toMatch(/no longer in the library|who\.ok/)
    expect(code).toContain("'https://example.test'")
    expect(code).toContain("const b = 'x'")
  })
})

describe('seamProblems', () => {
  const seam: Seam = { name: 'x', pattern: /\bfind\(/, under: [], allowed: { 'a.ts': 'home' } }
  const sources: Record<string, string> = { 'a.ts': 'find(1)', 'b.ts': 'find(2)', 'c.ts': '// find(3)' }
  const read = (path: string) => sources[path] ?? ''

  it('names a file that matches without being allowed, and ignores a match in a comment', () => {
    expect(seamProblems(seam, read, ['a.ts', 'b.ts', 'c.ts'])).toEqual(['b.ts matches'])
  })

  it('names an allowed file that no longer matches', () => {
    expect(seamProblems(seam, read, ['c.ts'])).toEqual(['a.ts is allowed but no longer matches: take it off the list'])
  })
})

describe('the source tree', () => {
  const read = (path: string) => readFileSync(path, 'utf8')

  it.each(SEAMS.map((seam) => [seam.name, seam] as const))('%s', (_name, seam) => {
    const files = seam.under.flatMap((path) => sourcesUnder(path, seam.tests))
    expect(files.length).toBeGreaterThan(0)
    expect(seamProblems(seam, read, files)).toEqual([])
  })
})
