import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENGINES } from '../../src/shared/run-code/engines.ts'
import { copyEngineFiles } from './engine-files.ts'

describe('copyEngineFiles', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'engine-files-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('copies every listed file under its served name', () => {
    const listed = Object.values(ENGINES).flatMap((e) => Object.keys(e.files).map((name) => join(e.dir, name)))
    expect(copyEngineFiles(dir)).toBe(listed.length)
    for (const file of listed) expect([file, existsSync(join(dir, 'run-code', file))]).toEqual([file, true])
  })

  it('fails, naming the file, when a package doesn’t have it', () => {
    expect(() => copyEngineFiles(dir, join(dir, 'no-modules'))).toThrow('pyodide/pyodide.mjs is missing')
  })
})
