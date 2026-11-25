export type OtherAudio = 'M4A' | 'Ogg' | 'Opus' | 'FLAC'

export type Sniffed = 'mp4' | 'mp3' | 'aax' | 'm4a-drm' | { other: OtherAudio | null }

export const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length))

export function isMp3Frame(bytes: Uint8Array, at: number): boolean {
  if (at + 4 > bytes.length) return false
  const b1 = bytes[at + 1] ?? 0
  const b2 = bytes[at + 2] ?? 0
  if (bytes[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return false
  const version = (b1 >> 3) & 3
  const layer = (b1 >> 1) & 3
  const bitrate = b2 >> 4
  const rate = (b2 >> 2) & 3
  return version !== 1 && layer === 1 && bitrate !== 15 && rate !== 3
}

function id3Size(bytes: Uint8Array): number {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'ID3') return 0
  const size = [6, 7, 8, 9].reduce((n, i) => (n << 7) | ((bytes[i] ?? 0) & 0x7f), 0)
  const footer = ((bytes[5] ?? 0) & 0x10) !== 0 ? 10 : 0
  return 10 + size + footer
}

function sniffMp4(bytes: Uint8Array): Sniffed {
  const major = ascii(bytes, 8, 4)
  const boxSize = Math.min(bytes.length, new DataView(bytes.buffer, bytes.byteOffset).getUint32(0))
  const brands = [major]
  for (let at = 16; at + 4 <= boxSize; at += 4) brands.push(ascii(bytes, at, 4))
  if (brands.includes('aax ')) return 'aax'
  if (major === 'M4P ') return 'm4a-drm'
  if (major === 'M4A ') return { other: 'M4A' }
  return 'mp4'
}

export function sniffAudio(bytes: Uint8Array): Sniffed {
  if (bytes.length < 12) return { other: null }
  if (ascii(bytes, 4, 4) === 'ftyp') return sniffMp4(bytes)
  const tag = id3Size(bytes)
  let at = tag
  while (tag && at < bytes.length && bytes[at] === 0) at++
  const rest = bytes.subarray(at)
  if (ascii(rest, 0, 4) === 'OggS') return { other: ascii(rest, 28, 8) === 'OpusHead' ? 'Opus' : 'Ogg' }
  if (ascii(rest, 0, 4) === 'fLaC') return { other: 'FLAC' }
  if (isMp3Frame(bytes, at)) return 'mp3'
  if (tag && at >= bytes.length) return 'mp3'
  return { other: null }
}
