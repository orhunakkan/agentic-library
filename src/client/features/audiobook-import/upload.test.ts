import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHUNK_BYTES } from '~/shared/audiobooks/limits'
import type { ChunkAnswer } from './audiobook-client'
import { chunkPlan, type SendChunk, uploadAll, wait } from './upload'

afterEach(() => vi.useRealTimers())

function server(fail: (n: number, offset: number, call: number) => ChunkAnswer | null = () => null) {
  const held = new Map<number, number>()
  const calls: [number, number, number][] = []
  const send: SendChunk = async (n, offset, bytes) => {
    calls.push([n, offset, bytes.size])
    const failed = fail(n, offset, calls.length)
    if (failed) return failed
    const now = held.get(n) ?? 0
    if (offset !== now) return { ok: false, offset: now }
    held.set(n, now + bytes.size)
    return { ok: true, received: now + bytes.size }
  }
  return { send, held, calls }
}

const blob = (size: number) => new Blob([new Uint8Array(size)])
const stopped = { ok: false, problem: { code: 'stopped' }, retry: true } as const

describe('chunkPlan', () => {
  it('cuts a file into chunks of 896 KiB from where it got to', () => {
    expect(chunkPlan(10, 0, 4)).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
    ])
    expect(chunkPlan(10, 6, 4)).toEqual([[6, 10]])
    expect(chunkPlan(0)).toEqual([])
    expect(chunkPlan(CHUNK_BYTES + 1)).toEqual([
      [0, CHUNK_BYTES],
      [CHUNK_BYTES, CHUNK_BYTES + 1],
    ])
  })
})

describe('uploadAll', () => {
  it('sends each file in order, chunk by chunk, and reports the bytes held', async () => {
    const { send, held, calls } = server()
    const progress: number[] = []
    const result = await uploadAll([blob(CHUNK_BYTES + 10), blob(5)], [0, 0], send, {
      signal: new AbortController().signal,
      parallel: 1,
      onProgress: (bytes) => progress.push(bytes),
    })
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([
      [1, 0, CHUNK_BYTES],
      [1, CHUNK_BYTES, 10],
      [2, 0, 5],
    ])
    expect([...held.entries()]).toEqual([
      [1, CHUNK_BYTES + 10],
      [2, 5],
    ])
    expect(progress.at(-1)).toBe(CHUNK_BYTES + 15)
  })

  it('carries on from where the server says the file has got to', async () => {
    const { send, held, calls } = server()
    held.set(1, 3)
    expect(await uploadAll([blob(8)], [0], send, { signal: new AbortController().signal })).toEqual({ ok: true })
    expect(calls).toEqual([
      [1, 0, 8],
      [1, 3, 5],
    ])
    expect(held.get(1)).toBe(8)
  })

  it('retries a failed chunk after 1, 3 and 9 seconds, then stops with what each file holds', async () => {
    vi.useFakeTimers()
    const { send, calls } = server((_, offset) => (offset > 0 ? stopped : null))
    const done = uploadAll([blob(CHUNK_BYTES + 1)], [0], send, { signal: new AbortController().signal })
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(9000)
    expect(calls).toHaveLength(5)
    expect(await done).toEqual({ ok: false, problem: { code: 'stopped' }, received: [CHUNK_BYTES] })
  })

  it('gets past a failure the retries outlast, and Resume carries on from the files’ offsets', async () => {
    vi.useFakeTimers()
    const { send } = server((_, __, call) => (call === 1 ? stopped : null))
    const done = uploadAll([blob(4)], [0], send, { signal: new AbortController().signal })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await done).toEqual({ ok: true })
    const again = server()
    again.held.set(1, 2)
    expect(await uploadAll([blob(4)], [2], again.send, { signal: new AbortController().signal })).toEqual({ ok: true })
    expect(again.calls).toEqual([[1, 2, 2]])
  })

  it('stops at once for a refusal it can’t retry, and stops the other files', async () => {
    const { send } = server((n) => (n === 2 ? { ok: false, problem: { code: 'server-full' }, retry: false } : null))
    const result = await uploadAll([blob(2 * CHUNK_BYTES), blob(3), blob(4)], [0, 0, 0], send, {
      signal: new AbortController().signal,
      parallel: 3,
    })
    expect(result).toMatchObject({ ok: false, problem: { code: 'server-full' } })
  })

  it('refuses a server that holds more than the file', async () => {
    const send: SendChunk = async () => ({ ok: false, offset: 99 })
    expect(await uploadAll([blob(4)], [0], send, { signal: new AbortController().signal })).toEqual({
      ok: false,
      problem: { code: 'interrupted' },
      received: [0],
    })
  })

  it('throws an AbortError on cancel, during a retry’s wait too', async () => {
    vi.useFakeTimers()
    const cancel = new AbortController()
    const { send } = server(() => stopped)
    const done = uploadAll([blob(4)], [0], send, { signal: cancel.signal })
    const caught = done.catch((error: DOMException) => error.name)
    await vi.advanceTimersByTimeAsync(500)
    cancel.abort()
    expect(await caught).toBe('AbortError')
    await expect(uploadAll([blob(4)], [0], send, { signal: cancel.signal })).rejects.toThrow('cancelled')
  })
})

describe('wait', () => {
  it('waits, or throws at once when already cancelled', async () => {
    vi.useFakeTimers()
    const done = wait(10, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(10)
    await expect(done).resolves.toBeUndefined()
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(wait(10, cancelled.signal)).rejects.toThrow('cancelled')
  })
})
