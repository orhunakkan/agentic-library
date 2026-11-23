import { describe, expect, it } from 'vitest'
import { aliasLang, codeLang, fenceLang, fileLang, type HintSource, isRunLang, langLabel, RUN_LANGS } from './langs.ts'

const el = (attrs: Record<string, string>): HintSource => ({ getAttribute: (name) => attrs[name] ?? null })

describe('codeLang', () => {
  it('reads each hint form', () => {
    expect(codeLang([el({ class: 'language-js' })])).toBe('javascript')
    expect(codeLang([el({ class: 'lang-javascript' })])).toBe('javascript')
    expect(codeLang([el({ class: 'hljs language-typescript' })])).toBe('typescript')
    expect(codeLang([el({ class: 'brush: js; gutter: false' })])).toBe('javascript')
    expect(codeLang([el({ class: 'brush:py' })])).toBe('python')
    expect(codeLang([el({ class: 'sourceCode python' })])).toBe('python')
    expect(codeLang([el({ class: 'python' })])).toBeNull()
    expect(codeLang([el({ 'data-code-language': 'javascript' })])).toBe('javascript')
    expect(codeLang([el({ 'data-lang': 'sql' })])).toBe('sql')
    expect(codeLang([el({ 'data-language': 'py' })])).toBe('python')
  })

  it('looks at the pre first, then its code child, and the first hint decides', () => {
    expect(codeLang([el({}), el({ class: 'language-ts' })])).toBe('typescript')
    expect(codeLang([el({ class: 'language-sql' }), el({ class: 'language-ts' })])).toBe('sql')
    expect(codeLang([el({ 'data-lang': 'bash' }), el({ class: 'language-js' })])).toBeNull()
    expect(codeLang([el({ 'data-lang': 'js', class: 'language-python' })])).toBe('javascript')
    expect(codeLang([el({ class: 'highlight' }), el({ class: 'language-js' })])).toBe('javascript')
  })

  it('refuses every other language and an empty mark', () => {
    for (const name of ['jsx', 'tsx', 'mysql', 'postgresql', 'plsql', 'bash', 'shell', 'html'])
      expect(codeLang([el({ class: `language-${name}` })])).toBeNull()
    expect(codeLang([el({ class: 'language-' })])).toBeNull()
    expect(codeLang([el({ class: 'sourceCode bash' })])).toBeNull()
    expect(codeLang([])).toBeNull()
    expect(codeLang([el({})])).toBeNull()
  })
})

describe('aliasLang', () => {
  it('maps every alias, in any case', () => {
    const aliases: Record<string, string[]> = {
      javascript: ['js', 'javascript', 'mjs', 'cjs', 'node', 'JS', 'JavaScript'],
      typescript: ['ts', 'typescript', 'mts', 'cts', 'TS'],
      python: ['py', 'python', 'python3', 'Python'],
      sql: ['sql', 'sqlite', 'sqlite3', 'SQL'],
    }
    for (const [lang, names] of Object.entries(aliases)) for (const name of names) expect(aliasLang(name)).toBe(lang)
    expect(aliasLang('constructor')).toBeNull()
    expect(aliasLang('')).toBeNull()
  })
})

describe('fenceLang', () => {
  it('takes the info string’s first word', () => {
    expect(fenceLang('js')).toBe('javascript')
    expect(fenceLang('ts title="x"')).toBe('typescript')
    expect(fenceLang('  python3 ')).toBe('python')
    expect(fenceLang('{.sql}')).toBe('sql')
    expect(fenceLang('jsx')).toBeNull()
    expect(fenceLang('')).toBeNull()
    expect(fenceLang(null)).toBeNull()
    expect(fenceLang(undefined)).toBeNull()
  })
})

describe('fileLang', () => {
  it('reads the extension', () => {
    expect(fileLang('examples/hello.js')).toBe('javascript')
    for (const ext of ['mjs', 'cjs']) expect(fileLang(`a.${ext}`)).toBe('javascript')
    for (const ext of ['ts', 'mts', 'cts', 'TS']) expect(fileLang(`src/a.${ext}`)).toBe('typescript')
    expect(fileLang('main.py')).toBe('python')
    expect(fileLang('db/schema.sql')).toBe('sql')
    expect(fileLang('App.jsx')).toBeNull()
    expect(fileLang('run.sh')).toBeNull()
    expect(fileLang('.js')).toBeNull()
    expect(fileLang('Makefile')).toBeNull()
    expect(fileLang('a.js/README')).toBeNull()
  })
})

describe('the list', () => {
  it('labels each language and knows its members', () => {
    expect(RUN_LANGS.map(langLabel)).toEqual(['JavaScript', 'TypeScript', 'Python', 'SQL'])
    expect(isRunLang('python')).toBe(true)
    expect(isRunLang('ruby')).toBe(false)
    expect(isRunLang(1)).toBe(false)
  })
})
