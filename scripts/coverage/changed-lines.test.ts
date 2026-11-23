import { describe, expect, it } from 'vitest'
import {
  changedCoverage,
  formatReport,
  lineRanges,
  parseDiff,
  parseLcov,
  repoPath,
  resolveRange,
} from './changed-lines.ts'

const LCOV = `TN:
SF:/repo/src/shared/a.ts
FN:1,a
DA:1,1
DA:2,1
DA:3,0
DA:5,0
DA:6,0
end_of_record
TN:
SF:C:\\Repo\\src\\shared\\b.ts
DA:10,4
end_of_record
`

const DIFF = `diff --git a/src/shared/a.ts b/src/shared/a.ts
index 1111111..2222222 100644
--- a/src/shared/a.ts
+++ b/src/shared/a.ts
@@ -1,0 +2,2 @@ export function a() {
+  if (x) return 1
+  return 2
@@ -9 +5 @@ export function b() {
-  old
+  new
@@ -12,3 +7,0 @@
-  gone
-  gone
-  gone
diff --git a/src/shared/removed.ts b/src/shared/removed.ts
deleted file mode 100644
--- a/src/shared/removed.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const x = 1
-export const y = 2
diff --git a/src/shared/c.ts b/src/shared/c.ts
new file mode 100644
--- /dev/null
+++ b/src/shared/c.ts
@@ -0,0 +1,3 @@
+export const c = 1
`

describe('repoPath', () => {
  it('makes absolute paths repo-relative, whatever the slashes and drive-letter case', () => {
    expect(repoPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(repoPath('C:\\Repo\\src\\a.ts', 'c:\\repo')).toBe('src/a.ts')
    expect(repoPath('./src/a.ts', '/elsewhere')).toBe('src/a.ts')
  })
})

describe('parseLcov', () => {
  it('reads the executable lines and their hit counts per file', () => {
    const hits = parseLcov(LCOV, '/repo')
    expect([...(hits.get('src/shared/a.ts') ?? [])]).toEqual([
      [1, 1],
      [2, 1],
      [3, 0],
      [5, 0],
      [6, 0],
    ])
    expect(parseLcov(LCOV, 'C:\\Repo').get('src/shared/b.ts')?.get(10)).toBe(4)
  })

  it('ignores DA lines outside a record', () => {
    expect(parseLcov('DA:1,1\n', '/repo').size).toBe(0)
  })
})

describe('parseDiff', () => {
  it('takes the added and changed lines from each hunk, by the new line numbers', () => {
    const changed = parseDiff(DIFF)
    expect([...(changed.get('src/shared/a.ts') ?? [])]).toEqual([2, 3, 5])
    expect([...(changed.get('src/shared/c.ts') ?? [])]).toEqual([1, 2, 3])
  })

  it('skips deleted files and pure deletions', () => {
    const changed = parseDiff(DIFF)
    expect(changed.has('src/shared/removed.ts')).toBe(false)
    expect(changed.get('src/shared/a.ts')?.has(7)).toBe(false)
  })
})

describe('changedCoverage', () => {
  it('counts only changed lines the report measures, and lists the ones no test ran', () => {
    const result = changedCoverage(parseLcov(LCOV, '/repo'), parseDiff(DIFF))
    expect(result).toEqual({ covered: 1, total: 3, uncovered: new Map([['src/shared/a.ts', [3, 5]]]) })
  })

  it('reports nothing when no measured line changed', () => {
    const changed = new Map([['README.md', new Set([1, 2])]])
    expect(changedCoverage(parseLcov(LCOV, '/repo'), changed)).toEqual({ covered: 0, total: 0, uncovered: new Map() })
  })
})

describe('lineRanges', () => {
  it('collapses consecutive lines into ranges', () => {
    expect(lineRanges([3, 4, 5, 9, 11, 12])).toEqual(['3-5', '9', '11-12'])
    expect(lineRanges([])).toEqual([])
  })
})

describe('resolveRange', () => {
  it('keeps a real range, and falls back to the last commit for a new branch or no range', () => {
    expect(resolveRange('abc..def')).toBe('abc..def')
    expect(resolveRange('abc')).toBe('abc..HEAD')
    expect(resolveRange(`${'0'.repeat(40)}..def`)).toBe('HEAD~1..HEAD')
    expect(resolveRange('..def')).toBe('HEAD~1..HEAD')
    expect(resolveRange(undefined)).toBe('HEAD~1..HEAD')
  })
})

describe('formatReport', () => {
  it('prints the percentage and each uncovered range as file:start-end', () => {
    const text = formatReport('unit', { covered: 3, total: 4, uncovered: new Map([['src/a.ts', [7, 8, 12]]]) })
    expect(text).toContain('**75.0%** (3 of 4 lines)')
    expect(text).toContain('- `src/a.ts:7-8`')
    expect(text).toContain('- `src/a.ts:12`')
  })

  it('says so when no measurable lines changed', () => {
    expect(formatReport('unit', { covered: 0, total: 0, uncovered: new Map() })).toContain(
      'No measurable lines changed.',
    )
  })
})
