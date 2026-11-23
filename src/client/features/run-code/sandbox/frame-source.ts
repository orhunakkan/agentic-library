import { inspect } from './inspect'
import { workerMain } from './worker-main'

export const FRAME_SANDBOX = 'allow-scripts'

export const ENGINE_PATH = '/run-code/'

export function framePolicy(origin: string): string {
  const engines = `${origin}${ENGINE_PATH}`
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${engines}`,
    'worker-src blob:',
    `connect-src ${engines}`,
  ].join('; ')
}

export interface FrameScope {
  parent: { postMessage(message: unknown, target: string): void }
  addEventListener(type: 'message', listener: (event: { source: unknown; data: unknown }) => void): void
  Worker: new (url: string) => FrameWorker
  Blob: typeof Blob
  URL: { createObjectURL(blob: Blob): string }
}

export interface FrameWorker {
  postMessage(message: unknown): void
  addEventListener(type: string, listener: (event: { data?: unknown; preventDefault(): void }) => void): void
}

export function frameMain(workerSource: string, scope: FrameScope): void {
  let worker: FrameWorker | null = null
  let current = ''
  const tell = (message: unknown) => scope.parent.postMessage(message, '*')
  scope.addEventListener('message', (event) => {
    if (event.source !== scope.parent) return
    const data = event.data as { kind?: unknown; id?: unknown }
    if (data?.kind !== 'run' || typeof data.id !== 'string') return
    current = data.id
    if (!worker) {
      try {
        const url = scope.URL.createObjectURL(new scope.Blob([workerSource], { type: 'text/javascript' }))
        worker = new scope.Worker(url)
      } catch {
        tell({ kind: 'failed', id: current, reason: 'worker' })
        return
      }
      worker.addEventListener('message', (message) => tell(message.data))
      worker.addEventListener('error', (error) => {
        error.preventDefault()
        tell({ kind: 'failed', id: current, reason: 'worker' })
      })
    }
    worker.postMessage(data)
  })
  tell({ kind: 'ready' })
}

export function workerSource(): string {
  return `(${String(workerMain)})(${String(inspect)}, self, (url) => import(url))`
}

const escapeAttribute = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function frameHtml(origin: string): string {
  const source = JSON.stringify(workerSource()).replace(/</g, '\\u003c')
  return [
    '<!doctype html>',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(framePolicy(origin))}">`,
    `<script>(${String(frameMain)})(${source}, self)</script>`,
  ].join('')
}
