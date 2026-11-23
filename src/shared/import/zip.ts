import { MAX_ZIP_TOTAL_BYTES } from './limits.ts'

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
const LOCAL_HEADER = 0x04034b50

export class ZipError extends Error {
  name = 'ZipError'
}

export interface ZipEntry {
  name: string
  size: number
  read(): Promise<Uint8Array>
}

export interface ZipOptions {
  maxTotalBytes?: number
}

const names = new TextDecoder('utf-8')

export function openZip(
  zip: Uint8Array,
  { maxTotalBytes = MAX_ZIP_TOTAL_BYTES }: ZipOptions = {},
): Map<string, ZipEntry> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const need = (at: number, length: number) => {
    if (at < 0 || at + length > zip.length) throw new ZipError('truncated ZIP file')
  }
  const u16 = (at: number) => {
    need(at, 2)
    return view.getUint16(at, true)
  }
  const u32 = (at: number) => {
    need(at, 4)
    return view.getUint32(at, true)
  }

  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_DIRECTORY) {
      end = i
      break
    }
  }
  if (end < 0) throw new ZipError('not a ZIP file: no end-of-directory record')
  const count = u16(end + 10)
  let at = u32(end + 16)
  if (count === 0xffff || at === 0xffffffff) throw new ZipError('ZIP64 archives are not supported')

  const files = new Map<string, ZipEntry>()
  let total = 0
  for (let n = 0; n < count; n++) {
    if (u32(at) !== DIRECTORY_ENTRY) throw new ZipError(`bad ZIP directory entry at ${at}`)
    const flags = u16(at + 8)
    const method = u16(at + 10)
    const compressedSize = u32(at + 20)
    const size = u32(at + 24)
    const nameLength = u16(at + 28)
    const extraLength = u16(at + 30)
    const commentLength = u16(at + 32)
    const localAt = u32(at + 42)
    need(at + 46, nameLength)
    const name = names.decode(zip.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue

    if (flags & 1) throw new ZipError(`${name} is encrypted`)
    if (compressedSize === 0xffffffff || size === 0xffffffff) throw new ZipError('ZIP64 archives are not supported')
    if (method !== 0 && method !== 8) throw new ZipError(`unsupported ZIP compression method ${method} for ${name}`)
    if (method === 0 && size !== compressedSize) throw new ZipError(`bad size for stored entry ${name}`)
    total += size
    if (total > maxTotalBytes) throw new ZipError('the archive is too large once uncompressed')

    if (u32(localAt) !== LOCAL_HEADER) throw new ZipError(`bad ZIP local header for ${name}`)
    const dataAt = localAt + 30 + u16(localAt + 26) + u16(localAt + 28)
    need(dataAt, compressedSize)
    const data = zip.subarray(dataAt, dataAt + compressedSize)
    files.set(name, {
      name,
      size,
      read: () => (method === 0 ? Promise.resolve(data) : inflateRaw(data, size, name)),
    })
  }
  return files
}

async function inflateRaw(data: Uint8Array, size: number, name: string): Promise<Uint8Array> {
  const out = new Uint8Array(size)
  let written = 0
  const reader = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (written + value.length > size) throw new ZipError(`${name} inflates to more than its declared size`)
      out.set(value, written)
      written += value.length
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error instanceof ZipError ? error : new ZipError(`${name} is damaged: ${(error as Error).message}`)
  }
  if (written !== size) throw new ZipError(`${name} inflates to less than its declared size`)
  return out
}

export async function readZip(zip: Uint8Array, options?: ZipOptions): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  for (const [name, entry] of openZip(zip, options)) files.set(name, await entry.read())
  return files
}
