import { describe, expect, it } from 'vitest'
import { RUN_LANGS } from '~/shared/run-code/langs'
import {
  COLUMNS_CUT,
  durationText,
  HINTS,
  hintFor,
  OUTPUT_EMPTY,
  openLabel,
  ROWS_CUT,
  SIGNED_OUT_TEXT,
  shortcutText,
  statusText,
  TYPESCRIPT_NOTE,
  titleText,
} from './run-messages'

const js = { lang: 'javascript', mac: false } as const

describe('statusText', () => {
  it('says each state', () => {
    expect(statusText({ ...js, status: 'idle' })).toBe('Press Run, or Ctrl+Enter.')
    expect(statusText({ ...js, status: 'idle', mac: true })).toBe('Press Run, or ⌘+Enter.')
    expect(statusText({ status: 'loading', lang: 'python', mac: false })).toBe(
      'Getting Python ready. The first time downloads about 12 MB.',
    )
    expect(statusText({ status: 'loading', lang: 'sql', mac: false })).toBe('Getting SQLite ready.')
    expect(statusText({ ...js, status: 'running' })).toBe('Running…')
    expect(statusText({ ...js, status: 'done', ms: 12 })).toBe('Finished in 12 ms.')
    expect(statusText({ ...js, status: 'done', ms: 1400 })).toBe('Finished in 1.4 s.')
    expect(statusText({ ...js, status: 'done', ms: 12, empty: true })).toBe('Finished in 12 ms, with no output.')
    expect(statusText({ ...js, status: 'error', line: 3 })).toBe('Stopped by an error on line 3.')
    expect(statusText({ ...js, status: 'error' })).toBe('Stopped by an error.')
    expect(statusText({ ...js, status: 'timeout' })).toBe('Stopped after 5 seconds. A loop or a timer may never end.')
    expect(statusText({ status: 'timeout', lang: 'python', mac: false })).toBe(
      'Stopped after 10 seconds. A loop or a timer may never end.',
    )
    expect(statusText({ ...js, status: 'stopped' })).toBe('Stopped.')
    expect(statusText({ ...js, status: 'capped' })).toBe('Stopped: the output reached its limit.')
    expect(statusText({ status: 'engine_failed', lang: 'python', mac: false })).toBe(
      'Couldn’t get Python ready. Check your connection and try again.',
    )
    expect(statusText({ status: 'engine_failed', lang: 'sql', mac: false })).toBe(
      'Couldn’t get SQLite ready. Check your connection and try again.',
    )
    expect(statusText({ ...js, status: 'failed' })).toBe('Something went wrong. Try again.')
  })

  it('writes durations in milliseconds, then seconds', () => {
    expect([0, 0.4, 999, 1000, 1449, 12_345].map(durationText)).toEqual([
      '0 ms',
      '0 ms',
      '999 ms',
      '1.0 s',
      '1.4 s',
      '12.3 s',
    ])
    expect(shortcutText(false)).toBe('Ctrl+Enter')
  })
})

describe('hintFor', () => {
  it('explains what the page causes, by language', () => {
    for (const lang of ['javascript', 'typescript'] as const) {
      expect(hintFor(lang, 'ReferenceError: require is not defined')).toBe(HINTS.node)
      expect(hintFor(lang, 'ReferenceError: process is not defined')).toBe(HINTS.node)
      expect(hintFor(lang, "Error: Cannot find module 'fs'")).toBe(HINTS.node)
      expect(hintFor(lang, 'ReferenceError: document is not defined')).toBe(HINTS.page)
      expect(hintFor(lang, 'ReferenceError: window is not defined')).toBe(HINTS.page)
      expect(hintFor(lang, 'TypeError: Failed to resolve module specifier "lodash".')).toBe(HINTS.module)
      expect(hintFor(lang, 'TypeError: Failed to fetch dynamically imported module: blob:null/1')).toBe(HINTS.module)
      expect(hintFor(lang, 'TypeError: The specifier “x” was a bare specifier')).toBe(HINTS.module)
      expect(hintFor(lang, 'TypeError: Importing a module script failed.')).toBe(HINTS.module)
      expect(hintFor(lang, 'TypeError: Failed to fetch')).toBe(HINTS.network)
      expect(hintFor(lang, 'TypeError: NetworkError when attempting to fetch resource.')).toBe(HINTS.network)
      expect(hintFor(lang, "TypeError: Failed to execute 'fetch': Failed to parse URL from /account")).toBe(
        HINTS.network,
      )
      expect(hintFor(lang, 'TypeError: Load failed')).toBe(HINTS.network)
      expect(hintFor(lang, 'TypeError: ten is not a function')).toBeNull()
    }
  })

  it('explains Python’s missing modules, input() and the network', () => {
    expect(hintFor('python', "ModuleNotFoundError: No module named 'numpy'")).toBe(HINTS.python)
    expect(hintFor('python', "RuntimeError: input() isn't available here")).toBe(HINTS.input)
    expect(hintFor('python', 'JsException: TypeError: Failed to fetch')).toBe(HINTS.network)
    expect(hintFor('python', 'ZeroDivisionError: division by zero')).toBeNull()
    expect(hintFor('python', 'require is not defined')).toBeNull()
  })

  it('explains SQL’s empty database', () => {
    expect(hintFor('sql', 'Error in statement 2: no such table: employees')).toBe(HINTS.table)
    expect(hintFor('sql', 'Error in statement 1: near "selec": syntax error')).toBeNull()
  })

  it('has a full sentence for every hint', () => {
    for (const hint of Object.values(HINTS)) expect(hint).toMatch(/^[A-Zi].*\.$/)
  })
})

describe('the dialog’s other copy', () => {
  it('names each language’s example', () => {
    expect(RUN_LANGS.map(titleText)).toEqual([
      'JavaScript example',
      'TypeScript example',
      'Python example',
      'SQL example',
    ])
    expect(openLabel('sql')).toBe('Run SQL example')
    expect(TYPESCRIPT_NOTE).toBe('Types aren’t checked here. They’re removed, and the code runs as JavaScript.')
    expect(OUTPUT_EMPTY).toBe('Output appears here.')
    expect(SIGNED_OUT_TEXT).toBe('Sign in to run code. Running code is part of Pro.')
    expect([ROWS_CUT(200), COLUMNS_CUT(50)]).toEqual([
      'Only the first 200 rows are shown.',
      'Only the first 50 columns are shown.',
    ])
  })
})
