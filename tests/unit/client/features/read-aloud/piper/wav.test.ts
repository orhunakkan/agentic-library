import { describe, expect, it } from 'vitest'
import { durationMs, normalise, wav } from '~/client/features/read-aloud/piper/wav'

const ascii = (bytes: Uint8Array, at: number, n: number) => String.fromCharCode(...bytes.slice(at, at + n))

describe('wav', () => {
  it('writes a 16-bit mono header and the samples', () => {
    const bytes = wav(new Float32Array([0, 0.5, -0.5]), 22050)
    const view = new DataView(bytes.buffer)
    expect(bytes.length).toBe(44 + 6)
    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(42)
    expect(ascii(bytes, 8, 8)).toBe('WAVEfmt ')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint32(28, true)).toBe(44100)
    expect(view.getUint16(32, true)).toBe(2)
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(bytes, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(6)
    expect([0, 1, 2].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 16383, -16383])
  })

  it('clips at ±1', () => {
    const view = new DataView(wav(new Float32Array([2, -3]), 8000).buffer)
    expect(view.getInt16(44, true)).toBe(32767)
    expect(view.getInt16(46, true)).toBe(-32767)
  })
})

describe('normalise', () => {
  it('scales the loudest sample to ±1', () => {
    expect([...normalise(new Float32Array([0.25, -0.5]))]).toEqual([0.5, -1])
  })

  it('leaves silence silent', () => {
    expect([...normalise(new Float32Array([0, 1e-9]))]).toEqual([0, 0])
  })
})

describe('durationMs', () => {
  it('is samples over the rate', () => {
    expect(durationMs(22050, 22050)).toBe(1000)
  })
})
