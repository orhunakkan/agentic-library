import { describe, expect, it } from 'vitest'
import { isRepoId, PATH_MAX, parseAdd, parsePath, parseRepoAction, parseView } from './input.ts'

describe('parseAdd', () => {
  it('takes { url } as a string only', () => {
    expect(parseAdd({ url: 'https://github.com/a/b' })).toEqual({ url: 'https://github.com/a/b' })
    expect(parseAdd({ url: 3 })).toBeNull()
    expect(parseAdd({ url: 'x', extra: 1 })).toBeNull()
    expect(parseAdd({ url: 'x'.repeat(2001) })).toBeNull()
    expect(parseAdd('https://github.com/a/b')).toBeNull()
  })
})

describe('parseRepoAction', () => {
  it('takes refresh or remove, exactly', () => {
    expect(parseRepoAction({ intent: 'refresh' })).toBe('refresh')
    expect(parseRepoAction({ intent: 'remove' })).toBe('remove')
    expect(parseRepoAction({ intent: 'delete' })).toBeNull()
    expect(parseRepoAction({ intent: 'remove', id: 'x' })).toBeNull()
    expect(parseRepoAction(null)).toBeNull()
  })
})

describe('parsePath', () => {
  it('takes the root and relative paths', () => {
    expect(parsePath(undefined)).toBe('')
    expect(parsePath('')).toBe('')
    expect(parsePath('docs/guide.md')).toBe('docs/guide.md')
    expect(parsePath('.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml')
    expect(parsePath('a'.repeat(PATH_MAX))).toBe('a'.repeat(PATH_MAX))
  })

  it.each([
    ['a leading slash', '/etc/passwd'],
    ['a trailing slash', 'docs/'],
    ['an empty segment', 'docs//x'],
    ['a . segment', 'docs/./x'],
    ['a .. segment', 'docs/../../x'],
    ['.. alone', '..'],
    ['a NUL', 'a\0b'],
    ['a backslash', 'a\\b'],
    ['a newline', 'a\nb'],
    ['too long', 'a'.repeat(PATH_MAX + 1)],
    ['not a string', 3],
  ])('refuses %s', (_name, value) => {
    expect(parsePath(value)).toBeNull()
  })
})

describe('parseView and isRepoId', () => {
  it('reads the view and the id', () => {
    expect(parseView('code')).toBe('code')
    expect(parseView('anything')).toBe('preview')
    expect(isRepoId('0b6f1c4e-0000-4000-8000-000000000000')).toBe(true)
    expect(isRepoId('0B6F1C4E-0000-4000-8000-000000000000')).toBe(false)
    expect(isRepoId(7)).toBe(false)
  })
})
