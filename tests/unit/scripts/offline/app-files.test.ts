import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appFiles, isAppFile, writeAppFiles } from '../../../../scripts/offline/app-files.ts'

describe('appFiles', () => {
  it('leaves out source maps and .woff, keeps .woff2, and adds the shell', () => {
    const { files } = appFiles(['index-a1.js', 'index-a1.js.map', 'geist-b2.woff', 'geist-b2.woff2', 'app-c3.css'])
    expect(files).toEqual(['/_shell.html', '/assets/app-c3.css', '/assets/geist-b2.woff2', '/assets/index-a1.js'])
    expect(isAppFile('x.woff2')).toBe(true)
    expect(isAppFile('x.woff')).toBe(false)
  })

  it('leaves out the Folio voice’s engine, which its own download keeps', () => {
    for (const name of [
      'ort-wasm-simd-threaded-qh98TCA_.wasm',
      'piper_phonemize-DqQsg3fG.wasm',
      'piper_phonemize-CobbV0n5.data',
      'piper.worker-CjT4Zu89.js',
    ])
      expect(isAppFile(name)).toBe(false)
    expect(isAppFile('PlayerProvider-a1.js')).toBe(true)
  })

  it('gives the same build for the same list in any order, and another when a name changes', () => {
    const a = appFiles(['a-1.js', 'b-2.css'])
    expect(a.build).toMatch(/^[0-9a-f]{12}$/)
    expect(appFiles(['b-2.css', 'a-1.js']).build).toBe(a.build)
    expect(appFiles(['a-9.js', 'b-2.css']).build).not.toBe(a.build)
  })
})

describe('writeAppFiles', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes the manifest, nested assets included', () => {
    dir = mkdtempSync(join(tmpdir(), 'app-files-'))
    mkdirSync(join(dir, 'assets', 'sub'), { recursive: true })
    writeFileSync(join(dir, '_shell.html'), '<!doctype html>')
    writeFileSync(join(dir, 'assets', 'a-1.js'), '')
    writeFileSync(join(dir, 'assets', 'a-1.js.map'), '')
    writeFileSync(join(dir, 'assets', 'sub', 'w-2.mjs'), '')
    const manifest = writeAppFiles(dir)
    expect(manifest.files).toEqual(['/_shell.html', '/assets/a-1.js', '/assets/sub/w-2.mjs'])
    expect(JSON.parse(readFileSync(join(dir, 'app-files.json'), 'utf8'))).toEqual(manifest)
  })

  it('fails when the shell is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'app-files-'))
    mkdirSync(join(dir, 'assets'))
    expect(() => writeAppFiles(dir)).toThrow('/_shell.html is missing')
  })
})
