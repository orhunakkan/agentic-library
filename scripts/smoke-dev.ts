import { rmSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { folioVoice, voiceUrl } from '../src/shared/read-aloud/folio-voices.ts'
import { ENGINES } from '../src/shared/run-code/engines.ts'
import { CONTENT_DIR } from '../tests/content-folders.ts'

const PORT = 3200
delete process.env.DATABASE_URL
process.env.CONTENT_DIR ??= CONTENT_DIR
const errors: string[] = []
process.on('uncaughtException', (error) => errors.push(`uncaught: ${error.message}`))

const CACHE_DIR = 'node_modules/.vite-smoke'
rmSync(CACHE_DIR, { recursive: true, force: true })
const server = await createServer({ cacheDir: CACHE_DIR, server: { port: PORT, strictPort: true }, logLevel: 'error' })
const logError = server.config.logger.error
server.config.logger.error = (msg, options) => {
  errors.push(`vite: ${msg}`)
  logError(msg, options)
}
await server.listen()

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  page.on('console', (msg) => msg.type() === 'error' && errors.push(`console: ${msg.text()}`))
  for (const path of [
    '/',
    '/library',
    '/library/jane-austen/pride-and-prejudice',
    '/read/pride-and-prejudice/chapter-1/2',
    '/read/confessions-of-al-ghazzali/7',
    '/login',
    '/credits',
    '/terms',
    '/account/books',
  ]) {
    const response = await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle', timeout: 60_000 })
    if (response?.status() !== 200) errors.push(`${path}: HTTP ${response?.status()}`)
    await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached', timeout: 30_000 })
  }
  const og = await page.request.get(`http://localhost:${PORT}/og/library.png`)
  if (og.status() !== 200) errors.push(`/og/library.png: HTTP ${og.status()}`)
  const cori = folioVoice('en_GB-cori-medium')
  if (cori) {
    const onnx = voiceUrl(cori.files.onnx, cori.id)
    const head = await page.request.head(`http://localhost:${PORT}${onnx}`)
    const length = head.headers()['content-length']
    if (head.status() !== 200 || length !== String(cori.files.onnx.bytes))
      errors.push(`${onnx}: HTTP ${head.status()}, ${length} bytes (run pnpm voices:fetch en_GB-cori-medium)`)
  }
  const ran = await page.evaluate(async (module) => {
    const { FRAME_SANDBOX, frameHtml } = await import(/* @vite-ignore */ module)
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', FRAME_SANDBOX)
    frame.hidden = true
    frame.srcdoc = frameHtml(location.origin)
    return await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('no answer in 15 s'), 15_000)
      addEventListener('message', (event) => {
        if (event.source !== frame.contentWindow) return
        const message = event.data
        if (message.kind === 'ready')
          frame.contentWindow?.postMessage(
            { kind: 'run', id: 'smoke', lang: 'javascript', code: 'console.log(6 * 7)', engineBase: '' },
            '*',
          )
        if (message.kind === 'output' || message.kind === 'done' || message.kind === 'failed') {
          clearTimeout(timer)
          resolve(message.entries?.[0]?.text ?? message.error?.message ?? message.kind)
        }
      })
      document.body.append(frame)
    })
  }, '/src/client/features/run-code/sandbox/frame-source.ts')
  if (ran !== '42') errors.push(`Run code's sandbox in dev: ${ran}`)
  const wasm = `/run-code/${ENGINES.sqlite.dir}/sqlite3.wasm`
  const engine = await page.request.head(`http://localhost:${PORT}${wasm}`)
  const headers = engine.headers()
  if (
    engine.status() !== 200 ||
    headers['access-control-allow-origin'] !== '*' ||
    headers['content-type'] !== 'application/wasm'
  )
    errors.push(
      `${wasm}: HTTP ${engine.status()}, ${headers['content-type']}, CORS ${headers['access-control-allow-origin']}`,
    )
  const unknown = await page.request.get(`http://localhost:${PORT}/run-code/${ENGINES.sqlite.dir}/package.json`)
  if (unknown.status() !== 404) errors.push(`/run-code/…/package.json: HTTP ${unknown.status()}, not 404`)
  await page.waitForTimeout(1500)
} catch (error) {
  errors.push(`smoke: ${(error as Error).message}`)
} finally {
  await browser.close()
  await server.close()
}

if (errors.length > 0) {
  console.error(`Dev smoke test failed:\n${errors.join('\n')}`)
  process.exit(1)
}
console.log('Dev smoke test passed.')
