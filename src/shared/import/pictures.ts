import type { HTMLElement } from 'node-html-parser'
import type { PictureType, SourcePicture, SourceProblem } from './blocks.ts'
import type { PictureLookup } from './html.ts'
import { isSvg, sniffImage, svgSize } from './image.ts'
import { MB } from './limits.ts'
import { decodePath, joinPath } from './path.ts'

export const MAX_PICTURE_SOURCE_BYTES = 50 * MB

export type ReadEntry = (path: string) => Promise<{ size: number; read: () => Promise<Uint8Array> } | null>

type Resolved = { key: string; path: string } | { key: string; problem: SourceProblem }

export function resolveSource(src: string, base: string): Resolved {
  const address = src.trim()
  if (/^data:/i.test(address)) return { key: address, problem: 'unreadable' }
  if (/^(https?:)?\/\//i.test(address)) return { key: address, problem: 'remote' }
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) return { key: address, problem: 'missing' }
  const path = joinPath(base, decodePath(address.split('#')[0]?.split('?')[0] ?? ''))
  return path ? { key: path, path } : { key: address, problem: 'missing' }
}

export function pictureSources(root: HTMLElement): string[] {
  const sources = [
    ...root.querySelectorAll('img').map((img) => img.getAttribute('src')),
    ...root.querySelectorAll('image').map((image) => image.getAttribute('href') ?? image.getAttribute('xlink:href')),
  ]
  return [...new Set(sources.filter((s): s is string => Boolean(s?.trim())).map((s) => s.trim()))]
}

type Size = { width: number; height: number } | null

function identify(bytes: Uint8Array): { type: PictureType; size: Size } | null {
  const info = sniffImage(bytes)
  if (info) return { type: info.type, size: { width: info.width, height: info.height } }
  if (isSvg(bytes)) return { type: 'image/svg+xml', size: svgSize(new TextDecoder('utf-8').decode(bytes)) }
  return null
}

export class PicturePool {
  readonly pictures: SourcePicture[] = []
  private readonly numbers = new Map<string, number>()
  private readonly sizes = new Map<number, Size>()

  private add(picture: SourcePicture, size: Size = null): number {
    const known = this.numbers.get(picture.key)
    if (known) return known
    this.pictures.push(picture)
    const n = this.pictures.length
    this.numbers.set(picture.key, n)
    this.sizes.set(n, size)
    return n
  }

  async load(sources: readonly string[], base: string, entry: ReadEntry): Promise<void> {
    for (const src of sources) {
      const resolved = resolveSource(src, base)
      if (this.numbers.has(resolved.key)) continue
      if ('problem' in resolved) {
        this.add(resolved)
        continue
      }
      const found = await entry(resolved.path)
      if (!found) {
        this.add({ key: resolved.key, problem: 'missing' })
        continue
      }
      if (found.size > MAX_PICTURE_SOURCE_BYTES) {
        this.add({ key: resolved.key, problem: 'large' })
        continue
      }
      const bytes = await found.read().catch(() => null)
      const known = bytes && identify(bytes)
      if (bytes && known) this.add({ key: resolved.key, bytes, type: known.type }, known.size)
      else this.add({ key: resolved.key, problem: 'unreadable' })
    }
  }

  lookup(base: string): PictureLookup {
    return {
      file: (src) => {
        const resolved = resolveSource(src, base)
        return this.add('problem' in resolved ? resolved : { key: resolved.key, problem: 'missing' })
      },
      svg: (text) => {
        const bytes = new TextEncoder().encode(text)
        return this.add({ key: `svg:${text}`, bytes, type: 'image/svg+xml' }, svgSize(text))
      },
      size: (n) => this.sizes.get(n) ?? null,
    }
  }
}
