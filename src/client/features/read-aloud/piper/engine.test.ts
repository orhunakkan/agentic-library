import { describe, expect, it, vi } from 'vitest'
import { createEngine, type EngineError, type WorkerLike } from './engine'
import type { FromWorker, ToWorker } from './protocol'

const FILES = { ortWasm: '/assets/ort.wasm', piperWasm: '/assets/p.wasm', piperData: '/assets/p.data' }
const CORI = { id: 'en_GB-cori-medium', model: '/voices/c.onnx', config: '/voices/c.json' }

function fakeWorkers() {
  const made: (WorkerLike & { sent: ToWorker[]; answer: (m: FromWorker) => void; crash: () => void })[] = []
  const make = () => {
    const w = {
      sent: [] as ToWorker[],
      onmessage: null as WorkerLike['onmessage'],
      onerror: null as WorkerLike['onerror'],
      postMessage(m: ToWorker) {
        w.sent.push(m)
      },
      terminate: vi.fn(),
      answer: (m: FromWorker) => w.onmessage?.({ data: m }),
      crash: () => w.onerror?.({}),
    }
    made.push(w)
    return w
  }
  return { made, make }
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: EngineError) => e.code,
  )

describe('createEngine', () => {
  it('loads a voice, then makes an utterance', async () => {
    const { made, make } = fakeWorkers()
    const engine = createEngine(make, FILES)
    const ready = engine.load(CORI)
    expect(engine.load(CORI)).toBe(ready)
    expect(made).toHaveLength(1)
    const w = made[0] as (typeof made)[number]
    expect(w.sent[0]).toEqual({ type: 'load', voice: CORI, engine: FILES })
    w.answer({ type: 'ready', voice: CORI.id })
    await ready
    const job = engine.synth('a', 'Hello.')
    expect(w.sent[1]).toEqual({ type: 'synth', id: 'a', text: 'Hello.' })
    const wav = new ArrayBuffer(4)
    w.answer({ type: 'audio', id: 'a', wav, ms: 120 })
    await expect(job).resolves.toEqual({ wav, ms: 120 })
  })

  it('rejects a failed load and a failed job with their codes', async () => {
    const { made, make } = fakeWorkers()
    const engine = createEngine(make, FILES)
    const ready = engine.load(CORI)
    const job = engine.synth('a', 'Hello.')
    const w = made[0] as (typeof made)[number]
    w.answer({ type: 'error', code: 'local_missing' })
    w.answer({ type: 'error', id: 'a', code: 'local_missing' })
    expect(await code(ready)).toBe('local_missing')
    expect(await code(job)).toBe('local_missing')
    void engine.load(CORI)
    expect(w.sent.filter((m) => m.type === 'load')).toHaveLength(2)
  })

  it('drops queued jobs, telling the worker', async () => {
    const { made, make } = fakeWorkers()
    const engine = createEngine(make, FILES)
    const a = engine.synth('a', 'One.')
    const b = engine.synth('b', 'Two.')
    engine.drop(['a', 'zzz'])
    expect(await code(a)).toBe('dropped')
    const w = made[0] as (typeof made)[number]
    expect(w.sent.at(-1)).toEqual({ type: 'cancel', ids: ['a'] })
    engine.drop(['zzz'])
    expect(w.sent.at(-1)).toEqual({ type: 'cancel', ids: ['a'] })
    w.answer({ type: 'audio', id: 'b', wav: new ArrayBuffer(0), ms: 1 })
    expect(await code(b)).toBe('ok')
  })

  it('rejects everything with local_failed when the worker dies, and starts a new one next time', async () => {
    const { made, make } = fakeWorkers()
    const engine = createEngine(make, FILES)
    const ready = engine.load(CORI)
    const job = engine.synth('a', 'One.')
    const w = made[0] as (typeof made)[number]
    w.crash()
    expect(await code(ready)).toBe('local_failed')
    expect(await code(job)).toBe('local_failed')
    expect(w.terminate).toHaveBeenCalled()
    w.answer({ type: 'ready', voice: CORI.id })
    void engine.load(CORI)
    expect(made).toHaveLength(2)
  })

  it('keeps one worker per page until terminated', async () => {
    const { made, make } = fakeWorkers()
    const engine = createEngine(make, FILES)
    void engine.load(CORI)
    void engine.load({ ...CORI, id: 'other' })
    void engine.synth('a', 'x').catch(() => {})
    expect(made).toHaveLength(1)
    engine.terminate()
    expect(made[0]?.terminate).toHaveBeenCalled()
    void engine.synth('b', 'y').catch(() => {})
    expect(made).toHaveLength(2)
  })
})
