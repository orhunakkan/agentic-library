export const RUN_CODE_PREFIX = '/run-code/'

export type EngineName = 'python' | 'sqlite'

export interface EngineFiles {
  package: string
  version: string
  dir: string
  files: Readonly<Record<string, string>>
}

export const PYODIDE_VERSION = '314.0.8'
export const SQLITE_VERSION = '3.54.1-build1'

export const ENGINES: Readonly<Record<EngineName, EngineFiles>> = {
  python: {
    package: 'pyodide',
    version: PYODIDE_VERSION,
    dir: `pyodide-${PYODIDE_VERSION}`,
    files: {
      'pyodide.mjs': 'pyodide.mjs',
      'pyodide.asm.mjs': 'pyodide.asm.mjs',
      'pyodide.asm.wasm': 'pyodide.asm.wasm',
      'python_stdlib.zip': 'python_stdlib.zip',
      'pyodide-lock.json': 'pyodide-lock.json',
    },
  },
  sqlite: {
    package: '@sqlite.org/sqlite-wasm',
    version: SQLITE_VERSION,
    dir: `sqlite-${SQLITE_VERSION}`,
    files: { 'sqlite3.mjs': 'dist/index.mjs', 'sqlite3.wasm': 'dist/sqlite3.wasm' },
  },
}

export function engineBase(engine: EngineName, origin: string): string {
  return `${origin}${RUN_CODE_PREFIX}${ENGINES[engine].dir}/`
}

export function engineFile(pathname: string): { package: string; file: string } | null {
  if (!pathname.startsWith(RUN_CODE_PREFIX)) return null
  const [dir, name, ...rest] = pathname.slice(RUN_CODE_PREFIX.length).split('/')
  if (rest.length || !dir || !name) return null
  const engine = Object.values(ENGINES).find((e) => e.dir === dir)
  if (!engine || !Object.hasOwn(engine.files, name)) return null
  return { package: engine.package, file: engine.files[name] as string }
}
