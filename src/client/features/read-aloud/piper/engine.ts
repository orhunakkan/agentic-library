import type { FromWorker, ToWorker, WorkerErrorCode, WorkerVoice } from './protocol'

export interface WorkerLike {
  postMessage: (message: ToWorker) => void
  terminate: () => void
  onmessage: ((event: { data: FromWorker }) => void) | null
  onerror: ((event: unknown) => void) | null
}

export interface Made {
  wav: ArrayBuffer
  ms: number
}

export class EngineError extends Error {
  constructor(readonly code: WorkerErrorCode | 'dropped') {
    super(code)
  }
}

export interface Engine {
  load: (voice: WorkerVoice) => Promise<void>
  synth: (id: string, text: string) => Promise<Made>
  drop: (ids: string[]) => void
  terminate: () => void
}

export function createEngine(
  makeWorker: () => WorkerLike,
  engineFiles: Extract<ToWorker, { type: 'load' }>['engine'],
): Engine {
  let worker: WorkerLike | null = null
  let voice: {
    id: string
    ready: Promise<void>
    settle: { resolve: () => void; reject: (e: EngineError) => void }
  } | null = null
  const jobs = new Map<string, { resolve: (made: Made) => void; reject: (error: EngineError) => void }>()

  const failAll = (code: WorkerErrorCode) => {
    for (const job of jobs.values()) job.reject(new EngineError(code))
    jobs.clear()
    voice?.settle.reject(new EngineError(code))
    voice = null
  }

  const ensureWorker = (): WorkerLike => {
    if (worker) return worker
    const w = makeWorker()
    w.onmessage = ({ data }) => {
      if (w !== worker) return
      if (data.type === 'ready') {
        if (voice?.id === data.voice) voice.settle.resolve()
      } else if (data.type === 'audio') {
        jobs.get(data.id)?.resolve({ wav: data.wav, ms: data.ms })
        jobs.delete(data.id)
      } else if (data.id !== undefined) {
        jobs.get(data.id)?.reject(new EngineError(data.code))
        jobs.delete(data.id)
      } else {
        const failed = voice
        voice = null
        failed?.settle.reject(new EngineError(data.code))
      }
    }
    w.onerror = () => {
      if (w !== worker) return
      worker = null
      w.terminate()
      failAll('local_failed')
    }
    worker = w
    return w
  }

  return {
    load: (next) => {
      if (voice?.id === next.id) return voice.ready
      let settle = { resolve: () => {}, reject: (_e: EngineError) => {} }
      const ready = new Promise<void>((resolve, reject) => {
        settle = { resolve, reject }
      })
      ready.catch(() => {})
      voice = { id: next.id, ready, settle }
      ensureWorker().postMessage({ type: 'load', voice: next, engine: engineFiles })
      return ready
    },
    synth: (id, text) =>
      new Promise<Made>((resolve, reject) => {
        jobs.set(id, { resolve, reject })
        ensureWorker().postMessage({ type: 'synth', id, text })
      }),
    drop: (ids) => {
      const mine = ids.filter((id) => jobs.has(id))
      if (mine.length === 0) return
      for (const id of mine) {
        jobs.get(id)?.reject(new EngineError('dropped'))
        jobs.delete(id)
      }
      worker?.postMessage({ type: 'cancel', ids: mine })
    },
    terminate: () => {
      const w = worker
      worker = null
      w?.terminate()
      failAll('local_failed')
    },
  }
}
