export const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
])

export interface PiperGlobals {
  WebAssembly?: { validate: (bytes: Uint8Array<ArrayBuffer>) => boolean }
  Worker?: new (url: string, options?: WorkerOptions) => { terminate: () => void }
  caches?: unknown
  HTMLAudioElement?: unknown
}

function moduleWorkers(WorkerCtor: NonNullable<PiperGlobals['Worker']>): boolean {
  let read = false
  const options = {
    get type() {
      read = true
      return 'module' as const
    },
  }
  try {
    new WorkerCtor('blob://', options).terminate()
  } catch {}
  return read
}

export function canRunPiper(globals: PiperGlobals = globalThis as unknown as PiperGlobals): boolean {
  try {
    if (!globals.WebAssembly?.validate(SIMD_PROBE)) return false
    if (!globals.Worker || !globals.caches || !globals.HTMLAudioElement) return false
    return moduleWorkers(globals.Worker)
  } catch {
    return false
  }
}
