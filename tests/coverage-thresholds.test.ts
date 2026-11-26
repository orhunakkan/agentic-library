import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The file paths a vitest config gives a coverage threshold of its own; globs name no single file, so they are left out. */
function thresholdFiles(config: string): string[] {
  const start = config.indexOf('thresholds: {')
  if (start < 0) return []
  return [...config.slice(start).matchAll(/^\s*'([^'*]+\.tsx?)':/gm)].map((m) => m[1] as string)
}

describe('thresholdFiles', () => {
  it('lists per-file thresholds, after thresholds: and without globs', () => {
    const config = [
      "include: ['src/server/**/*.ts'],",
      'thresholds: {',
      '  lines: 96,',
      "  'src/server/auth.ts': FULL,",
      "  'src/client/**/*.ts': FULL,",
      "  'src/client/a.tsx': { lines: 90 },",
    ].join('\n')
    expect(thresholdFiles(config)).toEqual(['src/server/auth.ts', 'src/client/a.tsx'])
  })
})

describe.each(['vitest.config.ts', 'vitest.integration.config.ts', 'vitest.browser.config.ts'])('%s', (path) => {
  it('gives a coverage threshold only to files that exist, so a renamed or deleted file keeps none', () => {
    const files = thresholdFiles(readFileSync(path, 'utf8'))
    expect(files.filter((file) => !existsSync(file))).toEqual([])
  })
})
