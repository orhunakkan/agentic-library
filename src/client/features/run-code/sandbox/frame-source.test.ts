import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { FRAME_SANDBOX, type FrameScope, type FrameWorker, frameHtml, frameMain, framePolicy } from './frame-source'

const ORIGIN = 'https://dev.agenticlibrary.app'

describe('the frame’s policy and sandbox', () => {
  it('is exactly this', () => {
    expect(framePolicy(ORIGIN)).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: " +
        'https://dev.agenticlibrary.app/run-code/; worker-src blob:; connect-src https://dev.agenticlibrary.app/run-code/',
    )
    expect(FRAME_SANDBOX).toBe('allow-scripts')
  })

  it('never gives the frame its origin back, in any file of the feature', () => {
    const forbidden = ['allow', 'same', 'origin'].join('-')
    const dir = join(import.meta.dirname, '..')
    const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile())
    expect(files.length).toBeGreaterThan(5)
    for (const file of files)
      expect([file.name, readFileSync(join(file.parentPath, file.name), 'utf8').includes(forbidden)]).toEqual([
        file.name,
        false,
      ])
  })

  it('writes the policy into the document escaped, and one script that nothing in it can end early', () => {
    const html = frameHtml('https://a.example"><b')
    expect(html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="')).toBe(true)
    expect(html).toContain('https://a.example&quot;&gt;&lt;b/run-code/')
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html.match(/<script>/g)).toHaveLength(1)
  })
})

function fakeFrame(WorkerClass?: new (url: string) => FrameWorker) {
  const told: unknown[] = []
  const parent = { postMessage: (message: unknown) => told.push(message) }
  let listener: ((event: { source: unknown; data: unknown }) => void) | null = null
  const workers: { url: string; sent: unknown[]; listeners: Map<string, (event: never) => void> }[] = []
  class FakeWorker implements FrameWorker {
    readonly sent: unknown[] = []
    readonly listeners = new Map<string, (event: never) => void>()
    constructor(readonly url: string) {
      workers.push(this)
    }
    postMessage(message: unknown) {
      this.sent.push(message)
    }
    addEventListener(type: string, fn: (event: never) => void) {
      this.listeners.set(type, fn)
    }
  }
  const scope: FrameScope = {
    parent,
    addEventListener: (_type, fn) => {
      listener = fn
    },
    Worker: WorkerClass ?? FakeWorker,
    Blob,
    URL: { createObjectURL: () => 'blob:null/1' },
  }
  const send = (data: unknown, source: unknown = parent) => listener?.({ source, data })
  return { told, workers, scope, send }
}

describe('frameMain', () => {
  it('says ready, starts the worker on the first run and keeps it for the next, relaying both ways', () => {
    const { told, workers, scope, send } = fakeFrame()
    frameMain('worker source', scope)
    expect(told).toEqual([{ kind: 'ready' }])
    const run = { kind: 'run', id: 'r1', lang: 'python', code: 'print(1)', engineBase: '/run-code/' }
    send(run)
    send({ ...run, id: 'r2' })
    expect(workers).toHaveLength(1)
    expect(workers[0]?.url).toBe('blob:null/1')
    expect(workers[0]?.sent).toEqual([run, { ...run, id: 'r2' }])
    workers[0]?.listeners.get('message')?.({ data: { kind: 'started', id: 'r2' } } as never)
    expect(told.at(-1)).toEqual({ kind: 'started', id: 'r2' })
    let prevented = false
    workers[0]?.listeners.get('error')?.({ preventDefault: () => (prevented = true) } as never)
    expect([told.at(-1), prevented]).toEqual([{ kind: 'failed', id: 'r2', reason: 'worker' }, true])
  })

  it('ignores messages from anywhere but its parent, and anything that isn’t a run', () => {
    const { told, workers, scope, send } = fakeFrame()
    frameMain('', scope)
    send({ kind: 'run', id: 'r1' }, {})
    send({ kind: 'stop', id: 'r1' })
    send({ kind: 'run', id: 1 })
    send(null)
    expect([told, workers]).toEqual([[{ kind: 'ready' }], []])
  })

  it('says the worker failed when the browser won’t start one', () => {
    const { told, scope, send } = fakeFrame(
      class {
        constructor() {
          throw new Error('refused')
        }
      } as never,
    )
    frameMain('', scope)
    send({ kind: 'run', id: 'r1' })
    expect(told.at(-1)).toEqual({ kind: 'failed', id: 'r1', reason: 'worker' })
  })
})

describe('the frame as source', () => {
  it('runs frameMain, workerMain and inspect with nothing but what the frame and worker give them', async () => {
    const html = frameHtml(ORIGIN)
    const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'))
    const told: unknown[] = []
    const parent = {
      postMessage: (message: unknown): void => {
        told.push(message)
      },
    }
    const toFrame: { listener?: (event: { source: unknown; data: unknown }) => void } = {}
    class ContextWorker {
      private readonly listeners = new Map<string, (event: unknown) => void>()
      private readonly inner: Map<string, (event: unknown) => void> = new Map()
      constructor(url: string) {
        const self = createContext({
          postMessage: (data: unknown) => this.listeners.get('message')?.({ data }),
          addEventListener: (type: string, fn: (event: unknown) => void) => this.inner.set(type, fn),
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
          performance,
        })
        runInContext('globalThis.self = globalThis', self)
        runInContext(sources.get(url) ?? '', self)
      }
      postMessage(data: unknown) {
        this.inner.get('message')?.({ data, preventDefault: () => {} })
      }
      addEventListener(type: string, fn: (event: unknown) => void) {
        this.listeners.set(type, fn)
      }
    }
    const sources = new Map<string, string>()
    const frame = createContext({
      parent,
      addEventListener: (_type: string, fn: typeof toFrame.listener) => {
        toFrame.listener = fn
      },
      Worker: ContextWorker,
      Blob: class {
        constructor(readonly parts: string[]) {}
      },
      URL: {
        createObjectURL: (blob: { parts: string[] }) => {
          sources.set('blob:null/w', blob.parts.join(''))
          return 'blob:null/w'
        },
      },
    })
    runInContext('globalThis.self = globalThis', frame)
    runInContext(script, frame)
    expect(told).toEqual([{ kind: 'ready' }])
    const done = new Promise<void>((resolve) => {
      parent.postMessage = (message: unknown) => {
        told.push(message)
        if ((message as { kind: string }).kind === 'done') resolve()
      }
    })
    toFrame.listener?.({
      source: parent,
      data: { kind: 'run', id: 'r1', lang: 'javascript', code: 'console.log({ n: 10 * 10 }, [1])', engineBase: '' },
    })
    await done
    expect(told.slice(1)).toEqual([
      { kind: 'started', id: 'r1' },
      { kind: 'output', id: 'r1', entries: [{ t: 'line', level: 'log', text: '{ n: 100 } [ 1 ]', indent: 0 }] },
      { kind: 'done', id: 'r1', ms: expect.any(Number) },
    ])
  })
})
