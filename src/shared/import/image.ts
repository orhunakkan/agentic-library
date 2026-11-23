import { IMAGE_MAX_HEIGHT, IMAGE_MAX_WIDTH, IMAGE_MIN_SIDE, MAX_COVER_BYTES, MAX_IMAGE_BYTES } from './limits.ts'

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
export interface ImageInfo {
  type: ImageType
  width: number
  height: number
}

export const COVER_MIN_SIDE = 64
export const COVER_MAX_STORED_WIDTH = 2400
export const COVER_MAX_STORED_HEIGHT = 3600

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  bytes.length >= at + text.length && [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0))
const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0)
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8)
const u24le = (b: Uint8Array, at: number) => u16le(b, at) | ((b[at + 2] ?? 0) << 16)
const u32be = (b: Uint8Array, at: number) => u16be(b, at) * 0x10000 + u16be(b, at + 2)

const sized = (type: ImageType, width: number, height: number): ImageInfo | null =>
  width > 0 && height > 0 ? { type, width, height } : null

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function png(b: Uint8Array): ImageInfo | null {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null
  return sized('image/png', u32be(b, 16), u32be(b, 20))
}

const isFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
const isStandalone = (marker: number) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)

function jpeg(b: Uint8Array): ImageInfo | null {
  let at = 2
  while (at < b.length) {
    if (b[at] !== 0xff) return null
    while (b[at] === 0xff) at++
    const marker = b[at]
    if (marker === undefined) return null
    at++
    if (isStandalone(marker)) continue
    if (marker === 0xda || marker === 0xd9) return null
    if (at + 2 > b.length) return null
    const length = u16be(b, at)
    if (length < 2 || at + length > b.length) return null
    if (isFrame(marker)) {
      if (length < 7) return null
      return sized('image/jpeg', u16be(b, at + 5), u16be(b, at + 3))
    }
    at += length
  }
  return null
}

function webp(b: Uint8Array): ImageInfo | null {
  if (b.length < 30) return null
  if (ascii(b, 12, 'VP8 ')) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return sized('image/webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff)
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24)
    return sized('image/webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (ascii(b, 12, 'VP8X')) return sized('image/webp', u24le(b, 24) + 1, u24le(b, 27) + 1)
  return null
}

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return png(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes)
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return webp(bytes)
  if ((ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) && bytes.length >= 10)
    return sized('image/gif', u16le(bytes, 6), u16le(bytes, 8))
  return null
}

export type CoverCheck = { ok: true; info: ImageInfo } | { ok: false; problem: 'type' | 'small' | 'large' }

export function checkCoverImage(bytes: Uint8Array): CoverCheck {
  return checkPicture(bytes, {
    maxBytes: MAX_COVER_BYTES,
    maxWidth: COVER_MAX_STORED_WIDTH,
    maxHeight: COVER_MAX_STORED_HEIGHT,
    minSide: COVER_MIN_SIDE,
  })
}

export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export const COVER_QUALITIES = [0.82, 0.72, 0.6] as const

export const shortHash = (hex: string) => hex.slice(0, 8)

export type BookImageCheck =
  | { ok: true; info: ImageInfo & { type: 'image/jpeg' | 'image/png' } }
  | { ok: false; problem: 'type' | 'small' | 'large' }

function checkPicture(
  bytes: Uint8Array,
  limits: { maxBytes: number; maxWidth: number; maxHeight: number; minSide: number },
): BookImageCheck {
  const info = sniffImage(bytes)
  if (!info || (info.type !== 'image/jpeg' && info.type !== 'image/png')) return { ok: false, problem: 'type' }
  if (bytes.length > limits.maxBytes) return { ok: false, problem: 'large' }
  if (info.width > limits.maxWidth || info.height > limits.maxHeight) return { ok: false, problem: 'large' }
  if (info.width < limits.minSide || info.height < limits.minSide) return { ok: false, problem: 'small' }
  return { ok: true, info: { ...info, type: info.type } }
}

export function checkBookImage(bytes: Uint8Array): BookImageCheck {
  return checkPicture(bytes, {
    maxBytes: MAX_IMAGE_BYTES,
    maxWidth: IMAGE_MAX_WIDTH,
    maxHeight: IMAGE_MAX_HEIGHT,
    minSide: IMAGE_MIN_SIDE,
  })
}

export function outputTypeFor(source: ImageType | 'image/svg+xml'): 'image/png' | 'image/jpeg' {
  return source === 'image/jpeg' || source === 'image/webp' ? 'image/jpeg' : 'image/png'
}

const utf8 = new TextDecoder('utf-8')

function svgRoot(text: string): string | null {
  const start = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg\b([^>]*)>/i.exec(
    text.slice(0, 4096),
  )
  return start ? (start[1] ?? '') : null
}

export function isSvg(bytes: Uint8Array): boolean {
  return svgRoot(utf8.decode(bytes.subarray(0, 4096))) !== null
}

function length(value: string | undefined): number | null {
  const m = value && /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(value)
  const n = m ? Number(m[1]) : NaN
  return n > 0 ? n : null
}

function attribute(attributes: string, name: string): string | undefined {
  const m = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`).exec(attributes)
  return m ? (m[1] ?? m[2]) : undefined
}

export function svgSize(text: string): { width: number; height: number } | null {
  const root = svgRoot(text)
  if (root === null) return null
  const width = length(attribute(root, 'width'))
  const height = length(attribute(root, 'height'))
  const box = (attribute(root, 'viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const [, , boxWidth, boxHeight] = box.length === 4 && box.every(Number.isFinite) ? box : []
  if (width && height) return { width, height }
  if (boxWidth && boxHeight && boxWidth > 0 && boxHeight > 0) {
    if (width) return { width, height: (width * boxHeight) / boxWidth }
    if (height) return { width: (height * boxWidth) / boxHeight, height }
    return { width: boxWidth, height: boxHeight }
  }
  return null
}

const COLUMN_WIDTH = 660
const TALLEST_COUNTED = 560
const LINE_HEIGHT = 35
const WORDS_PER_LINE = 11

export function pageWeight(width: number, height: number): number {
  const shown = Math.min(width > COLUMN_WIDTH ? (height * COLUMN_WIDTH) / width : height, TALLEST_COUNTED)
  return Math.min(400, Math.max(40, Math.round((shown / LINE_HEIGHT) * WORDS_PER_LINE)))
}
