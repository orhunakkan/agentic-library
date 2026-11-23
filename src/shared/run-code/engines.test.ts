import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENGINES, engineBase, engineFile } from './engines.ts'

const root = join(import.meta.dirname, '../../..')
const installed = (name: string) =>
  (JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version

describe('the engines', () => {
  it('are the installed packages’ versions, with every listed file there', () => {
    for (const engine of Object.values(ENGINES)) {
      expect(engine.version).toBe(installed(engine.package))
      expect(engine.dir.endsWith(engine.version)).toBe(true)
      for (const file of Object.values(engine.files))
        expect([file, existsSync(join(root, 'node_modules', engine.package, file))]).toEqual([file, true])
    }
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    for (const engine of Object.values(ENGINES)) expect(pkg.dependencies[engine.package]).toBe(engine.version)
  })

  it('are served under versioned paths', () => {
    expect(engineBase('python', 'https://a.example')).toBe('https://a.example/run-code/pyodide-314.0.8/')
    expect(engineBase('sqlite', '')).toBe('/run-code/sqlite-3.54.1-build1/')
  })

  it('answers only the listed files', () => {
    expect(engineFile('/run-code/sqlite-3.54.1-build1/sqlite3.mjs')).toEqual({
      package: '@sqlite.org/sqlite-wasm',
      file: 'dist/index.mjs',
    })
    expect(engineFile('/run-code/pyodide-314.0.8/pyodide.asm.wasm')).toEqual({
      package: 'pyodide',
      file: 'pyodide.asm.wasm',
    })
    for (const path of [
      '/run-code/',
      '/run-code/pyodide-314.0.8/',
      '/run-code/pyodide-314.0.8/package.json',
      '/run-code/pyodide-314.0.8/../package.json',
      '/run-code/pyodide-0.1/pyodide.mjs',
      '/run-code/pyodide-314.0.8/pyodide.mjs/x',
      '/run-code/sqlite-3.54.1-build1/constructor',
      '/voices/pyodide.mjs',
    ])
      expect(engineFile(path), path).toBeNull()
  })
})
