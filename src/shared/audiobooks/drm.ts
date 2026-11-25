import { ascii } from './sniff.ts'

export type ReadRange = (start: number, end: number) => Promise<Uint8Array>

export type Mp4Audio = 'aac' | 'drm' | 'other' | 'none'

const PROTECTED = new Set(['drms', 'enca', 'aavd'])
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])
const MAX_STSD = 1024 * 1024
const MAX_BOXES = 10_000

interface Box {
  type: string
  start: number
  body: number
  end: number
}

async function boxes(read: ReadRange, start: number, end: number, budget: { left: number }): Promise<Box[]> {
  const found: Box[] = []
  let at = start
  while (at + 8 <= end && budget.left-- > 0) {
    const head = await read(at, Math.min(at + 16, end))
    if (head.length < 8) break
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    let size = view.getUint32(0)
    let body = at + 8
    if (size === 1) {
      if (head.length < 16) break
      size = Number(view.getBigUint64(8))
      body = at + 16
    } else if (size === 0) size = end - at
    if (size < body - at || at + size > end) break
    found.push({ type: ascii(head, 4, 4), start: at, body, end: at + size })
    at += size
  }
  return found
}

function sampleEntries(stsd: Uint8Array): { formats: string[]; sinf: boolean } {
  const view = new DataView(stsd.buffer, stsd.byteOffset, stsd.byteLength)
  const formats: string[] = []
  let sinf = false
  let at = 8
  while (at + 8 <= stsd.length) {
    const size = view.getUint32(at)
    if (size < 8 || at + size > stsd.length) break
    formats.push(ascii(stsd, at + 4, 4))
    if (ascii(stsd.subarray(at + 8, at + size), 0, size - 8).includes('sinf')) sinf = true
    at += size
  }
  return { formats, sinf }
}

export async function mp4Audio(read: ReadRange, size: number): Promise<Mp4Audio> {
  const budget = { left: MAX_BOXES }
  const kinds: Mp4Audio[] = []
  const walk = async (start: number, end: number, handler: string | null): Promise<void> => {
    const children = await boxes(read, start, end, budget)
    let kind = handler
    for (const box of children) {
      if (box.type === 'hdlr' && box.end - box.body >= 12) kind = ascii(await read(box.body + 8, box.body + 12), 0, 4)
      else if (CONTAINERS.has(box.type)) await walk(box.body, box.end, box.type === 'trak' ? null : kind)
      else if (box.type === 'stsd' && kind === 'soun' && box.end - box.body <= MAX_STSD) {
        const { formats, sinf } = sampleEntries(await read(box.body, box.end))
        if (sinf || formats.some((f) => PROTECTED.has(f))) kinds.push('drm')
        else kinds.push(formats.includes('mp4a') ? 'aac' : 'other')
      }
    }
  }
  try {
    await walk(0, size, null)
  } catch {
    return 'none'
  }
  if (kinds.includes('drm')) return 'drm'
  if (kinds.includes('aac')) return 'aac'
  return kinds.includes('other') ? 'other' : 'none'
}

export const readBytes =
  (bytes: Uint8Array): ReadRange =>
  async (start, end) =>
    bytes.subarray(start, Math.min(end, bytes.length))
