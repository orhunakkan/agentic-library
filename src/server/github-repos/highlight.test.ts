import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_MAX_BYTES, HIGHLIGHT_MAX_LINES, highlight, languageFor, languageForFence } from './highlight.ts'

describe('languageFor', () => {
  it.each([
    ['Dockerfile', 'docker'],
    ['Dockerfile.prod', 'docker'],
    ['src/App.tsx', 'tsx'],
    ['Makefile', 'make'],
    ['.gitignore', 'codeowners'],
    ['.env.local', 'dotenv'],
    ['lib/main.rs', 'rs'],
    ['include/a.h', 'c'],
    ['notes.MD', 'md'],
    ['script.py', 'py'],
    ['LICENSE', null],
    ['data.unknownext', null],
    ['.hidden', null],
  ])('%s → %s', (name, lang) => {
    expect(languageFor(name)).toBe(lang)
  })

  it('reads a fence’s info string', () => {
    expect(languageForFence('TypeScript title="x"')).toBe('typescript')
    expect(languageForFence('  ')).toBeNull()
    expect(languageForFence('hpp')).toBe('cpp')
    expect(languageForFence('nonsense')).toBeNull()
  })
})

describe('highlight', () => {
  it('gives compact tokens for a TypeScript line', async () => {
    const code = await highlight('const a: number = 1\n', 'typescript')
    expect(code.highlighted).toBe(true)
    expect(code.lines).toHaveLength(1)
    const [line] = code.lines
    expect(line?.map((r) => r[0]).join('')).toBe('const a: number = 1')
    expect(line?.[0]).toEqual(['const', expect.any(Number), 0])
    for (const [light, dark] of code.palette) {
      expect(light).toMatch(/^#[0-9A-Fa-f]{6}/)
      expect(dark).toMatch(/^#[0-9A-Fa-f]{6}/)
    }
    expect(new Set(line?.map((r) => r[1])).size).toBeGreaterThan(1)
  })

  it('is plain text without a language', async () => {
    expect(await highlight('a\r\nb\n\n', null)).toEqual({
      palette: [[expect.any(String), expect.any(String)]],
      lines: [[['a', 0, 0]], [['b', 0, 0]], []],
      highlighted: false,
    })
  })

  it('is plain text for a language Shiki doesn’t know', async () => {
    expect((await highlight('x', 'no-such-language')).highlighted).toBe(false)
  })

  it('is plain text past 256 KB or 10,000 lines', async () => {
    expect((await highlight('a'.repeat(HIGHLIGHT_MAX_BYTES + 1), 'typescript')).highlighted).toBe(false)
    expect((await highlight('a\n'.repeat(HIGHLIGHT_MAX_LINES), 'typescript')).highlighted).toBe(false)
    expect((await highlight('a\n'.repeat(HIGHLIGHT_MAX_LINES - 1), 'typescript')).highlighted).toBe(true)
  })

  it('highlights a 256 KB TypeScript file inside the time budget', async () => {
    const line = 'export function add(a: number, b: number): number { return a + b } // a comment\n'
    const text = line.repeat(Math.floor(HIGHLIGHT_MAX_BYTES / line.length))
    const started = performance.now()
    const code = await highlight(text, 'typescript')
    expect(code.highlighted).toBe(true)
    expect(performance.now() - started).toBeLessThan(15_000)
  }, 30_000)
})
