import { describe, expect, it } from 'vitest'
import { transpile } from '~/client/features/run-code/transpile'

describe('transpile', () => {
  it('removes types, satisfies and import type, and turns an enum into JavaScript', async () => {
    const result = await transpile(
      [
        "import type { Settings } from './settings'",
        'interface Point { x: number }',
        'enum Colour { Red, Green }',
        'const settings = { theme: "dark" } satisfies Settings',
        'function at(p: Point): number { return p.x as number }',
        'console.log(settings.theme, Colour.Green, at({ x: 1 }))',
      ].join('\n'),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.code).not.toMatch(/import type|interface|satisfies|: number|as number/)
    const logged: unknown[] = []
    new Function('console', result.code)({ log: (...args: unknown[]) => logged.push(...args) })
    expect(logged).toEqual(['dark', 1, 1])
  })

  it('keeps every line where it was, and import and export as they are', async () => {
    const result = await transpile(
      'type A = string\n\nconst a: A = "x"\nexport const b = a\nimport { c } from "./c"\nc(b)',
    )
    expect(result.ok && result.code.split('\n')).toEqual([
      '',
      '',
      'const a = "x"',
      'export const b = a',
      'import { c } from "./c"',
      'c(b)',
    ])
  })

  it('gives a syntax error with its line', async () => {
    const result = await transpile('const a = 1\nconst b = (\n')
    expect(result).toEqual({
      ok: false,
      error: { message: expect.stringMatching(/^SyntaxError: .*\(3:1\)$/), line: 3 },
    })
  })
})
