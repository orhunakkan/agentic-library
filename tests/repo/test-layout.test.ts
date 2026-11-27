import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * Every test, and every helper only tests use, lives in tests/: a unit test in `tests/unit/`, an integration test in
 * `tests/integration/`, a component test in `tests/component/`, and helpers in `tests/support/`. This keeps them from
 * going back beside the code in src/ or scripts/.
 */
function layoutProblems(files: string[]): string[] {
  return files.flatMap((file) => {
    if (/^(src|scripts)\/.*\.test\.tsx?$/.test(file)) return [`${file} is a test outside tests/`]
    if (/^src\/(.+\/)?testing\//.test(file))
      return [`${file} is in a testing/ folder in src/; helpers go in tests/support/`]
    if (/\.integration\.test\.ts$/.test(file) && !file.startsWith('tests/integration/'))
      return [`${file} is an integration test outside tests/integration/`]
    if (/\.browser\.test\.tsx$/.test(file) && !file.startsWith('tests/component/'))
      return [`${file} is a component test outside tests/component/`]
    return []
  })
}

/** The repo's files, tracked and new, leaving out what Git ignores. */
function repoFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

describe('layoutProblems', () => {
  it('names tests and test helpers in the old places, and nothing in the new ones', () => {
    expect(
      layoutProblems([
        'src/server/auth.test.ts',
        'src/client/features/ask/AskPanel.browser.test.tsx',
        'scripts/coverage/ratchet.test.ts',
        'src/server/testing/db-test.ts',
        'tests/unit/server/a.integration.test.ts',
        'tests/unit/client/a.browser.test.tsx',
        'tests/unit/server/auth.test.ts',
        'tests/unit/scripts/coverage/ratchet.test.ts',
        'tests/integration/server/books/books.integration.test.ts',
        'tests/component/client/features/ask/AskPanel.browser.test.tsx',
        'tests/support/server/db-test.ts',
        'tests/repo/comments.test.ts',
        'src/server/auth.ts',
      ]),
    ).toEqual([
      'src/server/auth.test.ts is a test outside tests/',
      'src/client/features/ask/AskPanel.browser.test.tsx is a test outside tests/',
      'scripts/coverage/ratchet.test.ts is a test outside tests/',
      'src/server/testing/db-test.ts is in a testing/ folder in src/; helpers go in tests/support/',
      'tests/unit/server/a.integration.test.ts is an integration test outside tests/integration/',
      'tests/unit/client/a.browser.test.tsx is a component test outside tests/component/',
    ])
  })
})

describe('the repo', () => {
  it('keeps every test and test helper in its folder in tests/', () => {
    const files = repoFiles()
    expect(files.filter((file) => file.startsWith('tests/unit/')).length).toBeGreaterThan(300)
    expect(layoutProblems(files)).toEqual([])
  })
})
