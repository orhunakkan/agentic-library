export function normalise(pcm: Float32Array): Float32Array {
  let peak = 0
  for (const s of pcm) peak = Math.max(peak, Math.abs(s))
  if (peak < 1e-8) return new Float32Array(pcm.length)
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = (pcm[i] as number) / peak
  return out
}

export function writeWavHeader(bytes: Uint8Array, sampleRate: number, bitsPerSample: 8 | 16, dataBytes: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const blockAlign = bitsPerSample / 8
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
}

export function wav(pcm: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + pcm.length * 2)
  writeWavHeader(bytes, sampleRate, 16, pcm.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i] as number))
    view.setInt16(44 + i * 2, Math.trunc(s * 32767), true)
  }
  return bytes
}

export const durationMs = (samples: number, sampleRate: number) => Math.round((samples / sampleRate) * 1000)
