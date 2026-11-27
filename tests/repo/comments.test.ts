import { readdirSync, readFileSync } from 'node:fs'
import { parseSync } from 'vite'
import { describe, expect, it } from 'vitest'

/**
 * Every comment is a `/** … *\/` block. Tool directives keep the form their tool reads
 * (`// biome-ignore`, `{/* biome-ignore *\/}`, `// @ts-expect-error`, `/// <reference>`, `/* @vite-ignore *\/`), and generated files are left alone.
 */

const UNDER = ['src', 'scripts', 'tests']
const GENERATED = new Set(['src/routeTree.gen.ts'])
const DIRECTIVE =
  /^\/(\/\/ <reference |[/*]\s*(biome-ignore|@ts-expect-error|@ts-ignore|eslint-disable|@vite-ignore)\b)/

function commentsIn(file: string, text: string): { line: number; text: string }[] {
  const { comments } = parseSync(file, text, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' })
  return comments.map((c) => ({
    line: text.slice(0, c.start).split('\n').length,
    text: text.slice(c.start, c.end),
  }))
}

function problemWith(comment: string): string | null {
  if (DIRECTIVE.test(comment) || comment.startsWith('/**')) return null
  return comment.startsWith('//') ? 'is a // comment' : 'is a /* */ comment without the second *'
}

function sources(): string[] {
  return UNDER.flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .map((name) => `${dir}/${name.replaceAll('\\', '/')}`)
      .filter((file) => /\.tsx?$/.test(file) && !file.includes('/node_modules/') && !GENERATED.has(file)),
  )
}

describe('commentsIn', () => {
  it('finds line, block and JSX comments, and skips // inside strings, regexes and URLs', () => {
    const text = [
      "const url = 'https://example.test' // trailing",
      'const re = /^\\/\\//',
      'const t = `a // $' + '{1} b`',
      '/** A doc. */',
      'export const a = <div>{/* biome-ignore lint/x: why */}</div>',
    ].join('\n')
    expect(commentsIn('x.tsx', text).map((c) => c.text)).toEqual([
      '// trailing',
      '/** A doc. */',
      '/* biome-ignore lint/x: why */',
    ])
  })
})

describe('problemWith', () => {
  it('accepts /** */ and tool directives, and names // and /* */', () => {
    expect(problemWith('/** What a book slug names. */')).toBeNull()
    expect(problemWith('// biome-ignore lint/a: b')).toBeNull()
    expect(problemWith('// @ts-expect-error a reason')).toBeNull()
    expect(problemWith('/// <reference lib="webworker" />')).toBeNull()
    expect(problemWith('/* @vite-ignore */')).toBeNull()
    expect(problemWith('/// a note')).toBe('is a // comment')
    expect(problemWith('{/* biome-ignore lint/a: b */}'.slice(1, -1))).toBeNull()
    expect(problemWith('// a note')).toBe('is a // comment')
    expect(problemWith('/* a note */')).toBe('is a /* */ comment without the second *')
  })
})

describe('the source tree', () => {
  it('writes every comment as /** … */', () => {
    const problems = sources().flatMap((file) =>
      commentsIn(file, readFileSync(file, 'utf8')).flatMap(({ line, text }) => {
        const problem = problemWith(text)
        return problem ? [`${file}:${line} ${problem}: ${text.split('\n')[0]}`] : []
      }),
    )
    expect(problems).toEqual([])
  })
})
