import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, sep } from 'node:path'
import type { Plugin } from 'vite'
import { LICENCE_OVERRIDES, type LicenceOverride } from './licence-overrides.ts'

/**
 * Writes `third-party-licenses.txt` to the client build: every package whose code is sent to browsers, with its
 * licence text. It reads the module ids of every client chunk and of every web worker's chunks, plus the engine
 * packages that are copied into the output after the build. A package with no licence file fails the build, unless
 * `licence-overrides.ts` supplies its text. The file is sorted and has no timestamps, so a lockfile gives one file.
 */

export const NOTICES_FILE = 'third-party-licenses.txt'

/** File names, in a package's root, that hold its licence or notices. */
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\b|[-_.]|$)/i

export interface PackageNotice {
  name: string
  version: string
  licence: string
  /** Each licence file, by its name in the package, or the override's text. */
  texts: { file: string; text: string }[]
  /** Why the text comes from an override, and where the source is. */
  note: string | null
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

/** A module id as a file path: without Vite's `\0` prefix or a query such as `?url` or `?worker`. */
export function modulePath(id: string): string {
  return id.replace(/^\0/, '').replace(/[?#].*$/, '')
}

function readManifest(dir: string): Record<string, unknown> | null {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return null
  const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'))
  return isRecord(manifest) ? manifest : null
}

/**
 * The root of the package a file under `node_modules` belongs to: the nearest folder above it whose `package.json`
 * has a name. Nested `package.json` files without one, such as `{"type":"module"}` in a `dist`, are skipped.
 */
export function packageRootOf(file: string): string | null {
  const parts = file.split(sep)
  const last = parts.lastIndexOf('node_modules')
  if (last === -1) return null
  const floor = parts.slice(0, last + 1).join(sep)
  for (let dir = dirname(file); dir.length > floor.length; dir = dirname(dir)) {
    const name = readManifest(dir)?.name
    if (typeof name === 'string' && name) return dir
  }
  return null
}

/** The name, version, licence and licence texts of the package at `root`. Throws if it has no licence text. */
export function readPackage(root: string, overrides: Readonly<Record<string, LicenceOverride>>): PackageNotice {
  const manifest = readManifest(root)
  const name = manifest?.name
  if (typeof name !== 'string' || !name) throw new Error(`${root} has no package.json with a name`)
  const version = typeof manifest?.version === 'string' ? manifest.version : 'unknown'
  const override = Object.hasOwn(overrides, name) ? overrides[name] : undefined
  const files = readdirSync(root)
    .filter((file) => LICENCE_FILE.test(file))
    .sort()
  if (override) {
    if (files.length)
      throw new Error(
        `${name} ${version} now ships its own licence file (${files.join(', ')}). Check it, and remove its entry from ` +
          'scripts/build/licence-overrides.ts.',
      )
    return {
      name,
      version,
      licence: override.licence,
      texts: override.texts.map(({ file, path }) => ({ file, text: readFileSync(path, 'utf8') })),
      note: override.note,
    }
  }
  const texts = files.map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }))
  if (!texts.length)
    throw new Error(
      `${name} ${version} goes to browsers but has no licence file. Add it to scripts/build/licence-overrides.ts ` +
        'with its licence text and the reason.',
    )
  const licence = typeof manifest?.license === 'string' ? manifest.license : 'see the licence text'
  return { name, version, licence, texts, note: null }
}

/** Every package that a set of module ids comes from, plus the named extra packages under `root`. */
export function collectPackages(
  moduleIds: Iterable<string>,
  root: string,
  extraPackages: readonly string[],
  overrides: Readonly<Record<string, LicenceOverride>> = LICENCE_OVERRIDES,
): PackageNotice[] {
  const roots = new Set<string>()
  for (const id of moduleIds) {
    const packageRoot = packageRootOf(modulePath(id))
    if (packageRoot) roots.add(packageRoot)
  }
  for (const name of extraPackages) roots.add(join(root, 'node_modules', ...name.split('/')))
  const byKey = new Map<string, PackageNotice>()
  for (const packageRoot of roots) {
    const notice = readPackage(packageRoot, overrides)
    byKey.set(`${notice.name}@${notice.version}`, notice)
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    return a.version.localeCompare(b.version)
  })
}

const RULE = '-'.repeat(79)

/** The text of `third-party-licenses.txt`: a header, then each package with its licence texts. */
export function noticesText(packages: readonly PackageNotice[], sourceUrl: string | null): string {
  const gplParts = packages.filter((notice) => /^GPL-3\.0\b/.test(notice.licence))
  const header = [
    'Third-party software in Folio’s browser code',
    '',
    `Folio’s own code is open source under the MIT licence${sourceUrl ? `. Its source: ${sourceUrl}` : ''}.`,
    'The code this site sends to your browser includes the packages below, each with its licence.',
    ...(gplParts.length
      ? ['', 'These parts are under the GPL-3.0, and their source is offered here:', ...gplParts.map(gplLine)]
      : []),
  ]
  const sections = packages.map((notice) =>
    [
      RULE,
      `${notice.name} ${notice.version}`,
      `License: ${notice.licence}`,
      ...(notice.note ? [notice.note] : []),
      ...notice.texts.flatMap(({ file, text }) => ['', `${file}:`, '', text.trimEnd()]),
    ].join('\n'),
  )
  return `${[header.join('\n'), ...sections].join('\n\n')}\n`
}

const gplLine = (notice: PackageNotice) => `- ${notice.name} ${notice.version}${notice.note ? `: ${notice.note}` : ''}`

export interface NoticesOptions {
  /** The project root, whose `node_modules` holds the extra packages. */
  root: string
  /** Packages copied into the output after the build, which Vite never sees. */
  extraPackages: readonly string[]
  sourceUrl: string | null
}

/**
 * Two plugins sharing what they collect: `worker` goes in `worker.plugins`, because Vite bundles web workers in a
 * build of their own, and `client` goes in `plugins`, where it adds the client chunks and writes the file.
 */
export function thirdPartyNotices(options: NoticesOptions): { client: Plugin; worker: () => Plugin } {
  const moduleIds = new Set<string>()
  /** Chunks list the modules in them. Assets, such as the fonts a stylesheet imports, list the files they came from. */
  const collect = (
    bundle: Record<string, { type: string; moduleIds?: readonly string[]; originalFileNames?: readonly string[] }>,
  ) => {
    for (const output of Object.values(bundle)) {
      const ids = output.type === 'chunk' ? output.moduleIds : output.originalFileNames
      for (const id of ids ?? []) {
        const path = modulePath(id)
        moduleIds.add(isAbsolute(path) ? path : join(options.root, path))
      }
    }
  }
  return {
    worker: () => ({
      name: 'third-party-notices:worker',
      apply: 'build',
      generateBundle(_, bundle) {
        collect(bundle)
      },
    }),
    client: {
      name: 'third-party-notices',
      apply: 'build',
      applyToEnvironment: (environment) => environment.name === 'client',
      generateBundle(_, bundle) {
        collect(bundle)
        const packages = collectPackages(moduleIds, options.root, options.extraPackages)
        this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: noticesText(packages, options.sourceUrl) })
      },
    },
  }
}
