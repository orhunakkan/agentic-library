import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGINES, RUN_CODE_PREFIX } from '../../src/shared/run-code/engines.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

export function copyEngineFiles(clientDir: string, modules = join(root, 'node_modules')): number {
  const target = join(clientDir, RUN_CODE_PREFIX)
  rmSync(target, { recursive: true, force: true })
  let count = 0
  for (const engine of Object.values(ENGINES)) {
    const dir = join(target, engine.dir)
    mkdirSync(dir, { recursive: true })
    for (const [name, file] of Object.entries(engine.files)) {
      const source = join(modules, engine.package, file)
      if (!existsSync(source)) throw new Error(`${engine.package}/${file} is missing`)
      copyFileSync(source, join(dir, name))
      count++
    }
  }
  return count
}

if (import.meta.main) {
  const dir = process.argv[2] ?? join(root, 'dist/client')
  try {
    console.log(`run-code: ${copyEngineFiles(dir)} engine files`)
  } catch (error) {
    console.error(`run-code: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
