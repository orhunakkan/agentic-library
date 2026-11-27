import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LicenceOverride } from '../../../../scripts/build/licence-overrides.ts'
import {
  collectPackages,
  modulePath,
  noticesText,
  packageRootOf,
  readPackage,
  thirdPartyNotices,
} from '../../../../scripts/build/third-party-notices.ts'

/**
 * A `node_modules` tree built for each run, since `node_modules/` is git-ignored and fixture packages can't be
 * committed: a plain package, a scoped one, one per licence-file name, one with a nested nameless package.json, and
 * one with no licence at all.
 */
let root: string
const modules = () => join(root, 'node_modules')

function writePackage(name: string, files: Record<string, string>, manifest: object = {}) {
  const dir = join(modules(), ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT', ...manifest }))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

const NO_OVERRIDES: Readonly<Record<string, LicenceOverride>> = {}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'folio-notices-'))
  writePackage('plain', { LICENSE: 'plain licence', 'index.js': '', 'README.md': 'not a licence' })
  writePackage('@scope/pkg', {
    'LICENSE.md': 'scoped licence',
    'dist/esm/index.js': '',
    'dist/esm/package.json': '{"type":"module"}',
  })
  writePackage('british', { LICENCE: 'licence, British spelling' })
  writePackage('copying', { 'COPYING.txt': 'copying text' })
  writePackage('noticed', { 'license-MIT': 'MIT text', NOTICE: 'notice text' })
  writePackage('bare', { 'index.js': '' })
  writeFileSync(join(root, 'override.txt'), 'the vendored text')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('modulePath', () => {
  it('drops Vite’s \\0 prefix and any query', () => {
    expect(modulePath('/a/node_modules/x/file.wasm?url')).toBe('/a/node_modules/x/file.wasm')
    expect(modulePath('\0/a/node_modules/x/worker.js?worker&inline')).toBe('/a/node_modules/x/worker.js')
    expect(modulePath('/a/node_modules/x/y.js#hash')).toBe('/a/node_modules/x/y.js')
  })
})

describe('packageRootOf', () => {
  it('finds the package a `?url` module belongs to', () => {
    expect(packageRootOf(modulePath(join(modules(), 'plain/index.js?url')))).toBe(join(modules(), 'plain'))
  })

  it('finds a scoped package’s root, past a nested package.json with no name', () => {
    expect(packageRootOf(join(modules(), '@scope/pkg/dist/esm/index.js'))).toBe(join(modules(), '@scope/pkg'))
  })

  it('ignores files outside node_modules', () => {
    expect(packageRootOf(join(root, 'src/app.ts'))).toBeNull()
  })
})

describe('readPackage', () => {
  it('reads every licence-file name, and nothing else', () => {
    expect(readPackage(join(modules(), 'plain'), NO_OVERRIDES).texts).toEqual([
      { file: 'LICENSE', text: 'plain licence' },
    ])
    expect(readPackage(join(modules(), '@scope/pkg'), NO_OVERRIDES).texts[0]?.file).toBe('LICENSE.md')
    expect(readPackage(join(modules(), 'british'), NO_OVERRIDES).texts[0]?.file).toBe('LICENCE')
    expect(readPackage(join(modules(), 'copying'), NO_OVERRIDES).texts[0]?.file).toBe('COPYING.txt')
    expect(readPackage(join(modules(), 'noticed'), NO_OVERRIDES).texts.map((t) => t.file)).toEqual([
      'NOTICE',
      'license-MIT',
    ])
  })

  it('throws, naming the package, when it has no licence file and no override', () => {
    expect(() => readPackage(join(modules(), 'bare'), NO_OVERRIDES)).toThrow(
      /^bare 1\.0\.0 goes to browsers but has no licence file/,
    )
  })

  it('throws when a package with an override starts shipping its own licence file', () => {
    const overrides = {
      plain: { licence: 'MIT', note: 'once had none', texts: [{ file: 'MIT', path: join(root, 'override.txt') }] },
    }
    expect(() => readPackage(join(modules(), 'plain'), overrides)).toThrow(
      /plain 1\.0\.0 now ships its own licence file/,
    )
  })

  it('takes the licence and its text from an override', () => {
    const overrides = {
      bare: {
        licence: 'GPL-3.0',
        note: 'why it is overridden',
        texts: [{ file: 'GPL', path: join(root, 'override.txt') }],
      },
    }
    expect(readPackage(join(modules(), 'bare'), overrides)).toEqual({
      name: 'bare',
      version: '1.0.0',
      licence: 'GPL-3.0',
      texts: [{ file: 'GPL', text: 'the vendored text' }],
      note: 'why it is overridden',
    })
  })
})

describe('collectPackages and noticesText', () => {
  const ids = () => [
    join(modules(), 'plain/index.js'),
    join(modules(), 'copying/a.js?url'),
    join(modules(), '@scope/pkg/dist/esm/index.js'),
    join(modules(), 'plain/other.js'),
    join(root, 'src/app.ts'),
  ]

  it('lists each package once, sorted by name, with the extra packages added', () => {
    const names = collectPackages(ids(), root, ['british'], NO_OVERRIDES).map((notice) => notice.name)
    expect(names).toEqual(['@scope/pkg', 'british', 'copying', 'plain'])
  })

  it('fails on a package with no licence', () => {
    expect(() => collectPackages([join(modules(), 'bare/index.js')], root, [], NO_OVERRIDES)).toThrow(/bare/)
  })

  it('gives the same text on every run, whatever order the modules came in', () => {
    const first = noticesText(collectPackages(ids(), root, [], NO_OVERRIDES), null)
    const second = noticesText(collectPackages(ids().reverse(), root, [], NO_OVERRIDES), null)
    expect(second).toBe(first)
    expect(first).toMatch(/^Third-party software in Folio’s browser code\n/)
    expect(first).toContain('Folio’s own code is open source under the MIT licence.')
    expect(first).not.toContain('GPL-3.0')
  })

  it('names the source when it is known, and lists the GPL-3.0 parts in the header', () => {
    const overrides = {
      bare: {
        licence: 'GPL-3.0',
        note: 'source at example.org',
        texts: [{ file: 'GPL', path: join(root, 'override.txt') }],
      },
    }
    const text = noticesText(
      collectPackages([join(modules(), 'bare/index.js')], root, [], overrides),
      'https://example.org/folio',
    )
    expect(text).toContain('Its source: https://example.org/folio.')
    expect(text).toContain(
      'These parts are under the GPL-3.0, and their source is offered here:\n- bare 1.0.0: source at example.org',
    )
  })
})

describe('thirdPartyNotices', () => {
  /** Runs a plugin's generateBundle hook the way Vite does, with only the one method it calls. */
  function runHook(hook: unknown, bundle: object, emitted: string[] = []) {
    if (typeof hook !== 'function') throw new Error('generateBundle is not a function')
    const context = { emitFile: (file: { source: string }) => emitted.push(file.source) }
    hook.call(context, {}, bundle, false)
    return emitted
  }

  it('lists packages from the worker’s chunks, the client’s chunks and the client’s assets, \\0 ids included', () => {
    const notices = thirdPartyNotices({ root, extraPackages: [], sourceUrl: null })
    runHook(notices.worker().generateBundle, {
      'worker.js': { type: 'chunk', moduleIds: [`\0${join(modules(), 'copying/a.js')}?commonjs-module`] },
    })
    const [text] = runHook(notices.client.generateBundle, {
      'index.js': { type: 'chunk', moduleIds: [join(modules(), 'plain/index.js')] },
      'font.woff2': { type: 'asset', originalFileNames: ['node_modules/british/font.woff2'] },
    })
    for (const name of ['plain 1.0.0', 'copying 1.0.0', 'british 1.0.0']) expect(text).toContain(`\n${name}\n`)
  })
})
