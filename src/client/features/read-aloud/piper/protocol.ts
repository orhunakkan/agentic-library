export interface WorkerVoice {
  id: string
  model: string
  config: string
}

export type ToWorker =
  | { type: 'load'; voice: WorkerVoice; engine: { ortWasm: string; piperWasm: string; piperData: string } }
  | { type: 'synth'; id: string; text: string }
  | { type: 'cancel'; ids: string[] }

export type WorkerErrorCode = 'local_missing' | 'local_failed' | 'synth_failed'

export type FromWorker =
  | { type: 'ready'; voice: string }
  | { type: 'audio'; id: string; wav: ArrayBuffer; ms: number }
  | { type: 'error'; id?: string; code: WorkerErrorCode }
