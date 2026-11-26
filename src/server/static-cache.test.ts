import { describe, expect, it } from 'vitest'
import { cacheControlFor, headersFor } from './static-cache'

describe('cacheControlFor', () => {
  it('sends the service worker, the offline page, the shell and the app files no-cache', () => {
    for (const path of ['/sw.js', '/offline.html', '/_shell.html', '/app-files.json']) {
      expect(cacheControlFor(path), path).toBe('no-cache')
    }
  })

  it('leaves every other path alone', () => {
    for (const path of [
      '/sw.js.map',
      '/offline.html/x',
      '/favicon.svg',
      '/icons/icon-192.png',
      '/',
      '/offline',
      '/_shell',
      '/app-files.json.gz',
      '/third-party-licenses.txt',
    ]) {
      expect(cacheControlFor(path), path).toBeNull()
    }
  })
})

describe('headersFor', () => {
  it('lets the sandboxed frame load the engine files, cached for a year', () => {
    const common = {
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    }
    expect(headersFor('/run-code/pyodide-314.0.8/pyodide.asm.wasm')).toEqual({
      ...common,
      'content-type': 'application/wasm',
    })
    expect(headersFor('/run-code/sqlite-3.54.1-build1/sqlite3.mjs')).toEqual({
      ...common,
      'content-type': 'text/javascript; charset=utf-8',
    })
    expect(headersFor('/run-code/pyodide-314.0.8/python_stdlib.zip')).toEqual(common)
  })

  it('leaves every other path alone', () => {
    for (const path of [
      '/sw.js',
      '/assets/index.js',
      '/voices/x.onnx',
      '/run-code',
      '/',
      '/third-party-licenses.txt',
    ]) {
      expect(headersFor(path), path).toBeNull()
    }
  })
})
