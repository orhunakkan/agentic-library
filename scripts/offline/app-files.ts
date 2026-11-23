import { createHash } from 'node:crypto'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SHELL_PATH = '/_shell.html'
export const MANIFEST_PATH = '/app-files.json'

export interface AppFiles {
  build: string
  files: string[]
}

const VOICE_ENGINE = /^(ort-wasm-simd-threaded|piper_phonemize|piper\.worker)-/

export function isAppFile(name: string): boolean {
  return !name.endsWith('.map') && !name.endsWith('.woff') && !VOICE_ENGINE.test(name)
}

export function appFiles(assetNames: string[]): AppFiles {
  const files = [...assetNames.filter(isAppFile).map((name) => `/assets/${name}`), SHELL_PATH].sort()
  const build = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12)
  return { build, files }
}

export function writeAppFiles(clientDir: string): AppFiles {
  if (!existsSync(join(clientDir, SHELL_PATH))) throw new Error(`${SHELL_PATH} is missing from ${clientDir}`)
  const assets = join(clientDir, 'assets')
  const names = readdirSync(assets, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(assets.length + 1)
        .replaceAll('\\', '/'),
    )
  const manifest = appFiles(names)
  writeFileSync(join(clientDir, MANIFEST_PATH), `${JSON.stringify(manifest)}\n`)
  return manifest
}

if (import.meta.main) {
  const dir = process.argv[2] ?? fileURLToPath(new URL('../../dist/client/', import.meta.url))
  try {
    const { build, files } = writeAppFiles(dir)
    console.log(`app-files.json: build ${build}, ${files.length} files`)
  } catch (error) {
    console.error(`app-files: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
