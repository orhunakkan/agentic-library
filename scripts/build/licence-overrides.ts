import { fileURLToPath } from 'node:url'

/**
 * Licence texts for packages that go to browsers without a licence file of their own. Each entry says why, and its
 * texts are vendored under `scripts/build/licences/`, fetched from the licence's own source, never written by hand.
 */
export interface LicenceOverride {
  /** The licence the shipped code is under, which may differ from the package's `license` field. */
  licence: string
  /** Why the override is needed, and where the source is. Printed in the notices file. */
  note: string
  /** Each vendored text: its name as the notices file shows it, and its path. */
  texts: readonly { file: string; path: string }[]
}

const licenceText = (file: string) => fileURLToPath(new URL(`./licences/${file}`, import.meta.url))

/** onnxruntime's npm packages ship no licence file. This is the LICENSE from Microsoft's own 1.31.1 wheel on PyPI. */
const ONNXRUNTIME: LicenceOverride = {
  licence: 'MIT',
  note:
    'Its npm package ships no licence file. The text is the LICENSE in Microsoft’s onnxruntime 1.31.1 release on ' +
    'PyPI. Source: https://github.com/microsoft/onnxruntime',
  texts: [{ file: 'LICENSE (from the onnxruntime 1.31.1 wheel on PyPI)', path: licenceText('onnxruntime-MIT.txt') }],
}

export const LICENCE_OVERRIDES: Readonly<Record<string, LicenceOverride>> = {
  '@diffusionstudio/piper-wasm': {
    licence: 'GPL-3.0',
    note:
      'Its package.json says MIT, but it ships no licence file, and its build is espeak-ng and piper-phonemize compiled ' +
      'to WebAssembly, which are GPL-3.0. Source: https://github.com/diffusion-studio/piper-wasm, ' +
      'https://github.com/rhasspy/espeak-ng and https://github.com/wide-video/piper-phonemize',
    texts: [{ file: 'GPL-3.0 (from https://www.gnu.org/licenses/gpl-3.0.txt)', path: licenceText('GPL-3.0.txt') }],
  },
  '@sqlite.org/sqlite-wasm': {
    licence: 'Apache-2.0',
    note:
      'Its npm package ships no licence file, and its 3.54.1-build1 tag has none. Its package.json says Apache-2.0, ' +
      'for the wrapper. SQLite itself is in the public domain. Source: https://github.com/sqlite/sqlite-wasm and ' +
      'https://sqlite.org/copyright.html',
    texts: [
      {
        file: 'Apache-2.0 (from https://www.apache.org/licenses/LICENSE-2.0.txt)',
        path: licenceText('Apache-2.0.txt'),
      },
    ],
  },
  'onnxruntime-common': ONNXRUNTIME,
  'onnxruntime-web': ONNXRUNTIME,
  pyodide: {
    licence: 'MPL-2.0; Python’s standard library is under the PSF License',
    note:
      'Its npm package ships no licence file. Pyodide is MPL-2.0, and python_stdlib.zip is CPython 3.14.2’s standard ' +
      'library. Source: https://github.com/pyodide/pyodide and https://github.com/python/cpython',
    texts: [
      { file: 'LICENSE (Pyodide, at its 314.0.8 tag)', path: licenceText('pyodide-MPL-2.0.txt') },
      { file: 'LICENSE (CPython, at its v3.14.2 tag)', path: licenceText('cpython-3.14.2.txt') },
    ],
  },
}
