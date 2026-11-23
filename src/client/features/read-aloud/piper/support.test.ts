import { describe, expect, it } from 'vitest'
import { canRunPiper, type PiperGlobals, SIMD_PROBE } from './support'

class ModuleWorker {
  constructor(_url: string, options?: WorkerOptions) {
    void options?.type
    throw new SyntaxError('bad URL')
  }
  terminate() {}
}
class ClassicWorker {
  constructor(_url: string) {
    throw new SyntaxError('bad URL')
  }
  terminate() {}
}

const all: PiperGlobals = {
  WebAssembly: { validate: (bytes) => bytes === SIMD_PROBE },
  Worker: ModuleWorker,
  caches: {},
  HTMLAudioElement: class {},
}

describe('canRunPiper', () => {
  it('is true with everything there', () => {
    expect(canRunPiper(all)).toBe(true)
  })

  it('is false without SIMD, WebAssembly, a module worker, caches or audio', () => {
    expect(canRunPiper({ ...all, WebAssembly: { validate: () => false } })).toBe(false)
    expect(canRunPiper({ ...all, WebAssembly: undefined })).toBe(false)
    expect(canRunPiper({ ...all, Worker: undefined })).toBe(false)
    expect(canRunPiper({ ...all, Worker: ClassicWorker })).toBe(false)
    expect(canRunPiper({ ...all, caches: undefined })).toBe(false)
    expect(canRunPiper({ ...all, HTMLAudioElement: undefined })).toBe(false)
  })

  it('is false when probing throws', () => {
    expect(
      canRunPiper({
        ...all,
        WebAssembly: {
          validate: () => {
            throw new Error('no')
          },
        },
      }),
    ).toBe(false)
  })

  it('probes real WebAssembly here', () => {
    expect(WebAssembly.validate(SIMD_PROBE)).toBe(true)
  })
})
