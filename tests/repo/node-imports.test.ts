import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Node runs the scripts folder's .ts files itself, with type stripping and no bundler: the `~/` alias and
 * extensionless relative paths resolve only under Vite and Vitest, so they fail at run time.
 * Every module a script reaches must import with a relative path that names its `.ts` file.
 */

const ROOT = resolve(import.meta.dirname, '../..')
const SPECIFIER =
  /(?:^|[\n;])\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function runtimeImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
  return [...code.matchAll(SPECIFIER)].filter((m) => !m[1]).map((m) => (m[2] ?? m[3]) as string)
}

function problemWith(specifier: string): string | null {
  if (specifier.startsWith('~/')) return 'uses the ~/ alias'
  if (specifier.startsWith('.') && !/\.(ts|tsx|json)$/.test(specifier)) return 'has no .ts extension'
  return null
}

function scripts(): string[] {
  return readdirSync(join(ROOT, 'scripts'), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name))
    .map((name) => join(ROOT, 'scripts', name))
}

function nodeImportProblems(): string[] {
  const seen = new Set<string>()
  const problems: string[] = []
  const queue = scripts()
  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of runtimeImports(readFileSync(file, 'utf8'))) {
      const problem = problemWith(specifier)
      if (problem) problems.push(`${relative(ROOT, file)}: '${specifier}' ${problem}`)
      else if (specifier.startsWith('.') && /\.tsx?$/.test(specifier)) {
        const target = resolve(dirname(file), specifier)
        if (existsSync(target)) queue.push(target)
      }
    }
  }
  return problems.sort()
}

describe('runtimeImports', () => {
  it('reads static, side-effect, re-export and dynamic imports, and skips type-only ones and comments', () => {
    const source = [
      "import { a } from './a.ts'",
      "import '@tanstack/react-start/server-only'",
      "import type { B } from '~/b'",
      'import {\n  c,\n  type D,\n} from "../c.ts"',
      "export { e } from './e.ts'",
      "export type { F } from './f'",
      "const g = await import('./g.ts')",
      "// import { h } from '~/h'",
    ].join('\n')
    expect(runtimeImports(source)).toEqual([
      './a.ts',
      '@tanstack/react-start/server-only',
      '../c.ts',
      './e.ts',
      './g.ts',
    ])
  })
})

describe('problemWith', () => {
  it('names the alias and a missing extension, and passes packages and .ts paths', () => {
    expect(problemWith('~/shared/x')).toBe('uses the ~/ alias')
    expect(problemWith('../shared/x')).toBe('has no .ts extension')
    expect(problemWith('../shared/x.ts')).toBeNull()
    expect(problemWith('node:fs')).toBeNull()
    expect(problemWith('@anthropic-ai/sdk')).toBeNull()
  })
})

describe('modules Node runs from scripts/', () => {
  it('import only with relative .ts paths', () => {
    expect(nodeImportProblems()).toEqual([])
  })
})
