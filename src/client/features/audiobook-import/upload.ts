import { CHUNK_BYTES, PARALLEL_FILES } from '~/shared/audiobooks/limits'
import type { ChunkAnswer } from './audiobook-client'
import type { AudiobookProblem } from './audiobook-problems'

const RETRY_DELAYS_MS = [1000, 3000, 9000] as const

export type SendChunk = (n: number, offset: number, bytes: Blob, signal: AbortSignal) => Promise<ChunkAnswer>

export type UploadResult = { ok: true } | { ok: false; problem: AudiobookProblem; received: number[] }

export function chunkPlan(size: number, from = 0, chunk = CHUNK_BYTES): [number, number][] {
  const plan: [number, number][] = []
  for (let start = Math.max(0, from); start < size; start += chunk) plan.push([start, Math.min(size, start + chunk)])
  return plan
}

const abortError = () => new DOMException('The upload was cancelled.', 'AbortError')

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop)
      resolve()
    }, ms)
    const stop = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', stop, { once: true })
  })
}

async function uploadFile(
  file: Blob,
  n: number,
  from: number,
  send: SendChunk,
  signal: AbortSignal,
  onReceived: (received: number) => void,
): Promise<{ ok: true } | { ok: false; problem: AudiobookProblem; received: number }> {
  let offset = from
  let failures = 0
  while (offset < file.size) {
    if (signal.aborted) throw abortError()
    const answer = await send(n, offset, file.slice(offset, Math.min(file.size, offset + CHUNK_BYTES)), signal)
    if (answer.ok || 'offset' in answer) {
      const next = answer.ok ? answer.received : answer.offset
      if (next > file.size) return { ok: false, problem: { code: 'interrupted' }, received: offset }
      offset = next
      failures = 0
      onReceived(offset)
      continue
    }
    const delay = RETRY_DELAYS_MS[failures]
    if (!answer.retry || delay === undefined) return { ok: false, problem: answer.problem, received: offset }
    failures++
    await wait(delay, signal)
  }
  return { ok: true }
}

export async function uploadAll(
  files: readonly Blob[],
  received: readonly number[],
  send: SendChunk,
  options: { signal: AbortSignal; parallel?: number; onProgress?: (bytes: number) => void },
): Promise<UploadResult> {
  const held = files.map((_, i) => received[i] ?? 0)
  const report = () => options.onProgress?.(held.reduce((n, b) => n + b, 0))
  const stopping = new AbortController()
  const signal = AbortSignal.any([options.signal, stopping.signal])
  let failure: AudiobookProblem | null = null
  let next = 0
  report()
  const worker = async () => {
    while (next < files.length && !failure) {
      const i = next++
      const file = files[i] as Blob
      try {
        const result = await uploadFile(file, i + 1, held[i] ?? 0, send, signal, (bytes) => {
          held[i] = bytes
          report()
        })
        if (!result.ok) {
          held[i] = result.received
          failure ??= result.problem
          stopping.abort()
        }
      } catch (error) {
        if (options.signal.aborted || !stopping.signal.aborted) throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.parallel ?? PARALLEL_FILES, files.length) }, worker))
  if (options.signal.aborted) throw abortError()
  return failure ? { ok: false, problem: failure, received: held } : { ok: true }
}
