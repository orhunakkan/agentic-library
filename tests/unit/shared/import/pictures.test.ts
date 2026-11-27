import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseHtml } from '~/shared/import/html'
import {
  MAX_PICTURE_SOURCE_BYTES,
  PicturePool,
  pictureSources,
  type ReadEntry,
  resolveSource,
} from '~/shared/import/pictures'

const image = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/images/${name}`, import.meta.url)))
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"/>')

function archive(files: Record<string, Uint8Array>, sizes: Record<string, number> = {}) {
  const reads: string[] = []
  const entry: ReadEntry = async (path) => {
    const bytes = files[path]
    if (!bytes) return null
    return {
      size: sizes[path] ?? bytes.length,
      read: async () => {
        reads.push(path)
        return bytes
      },
    }
  }
  return { entry, reads }
}

describe('resolveSource', () => {
  it('resolves a path against its document’s folder, decoded and without its fragment or query', () => {
    expect(resolveSource('../images/a.png', 'OEBPS/text')).toEqual({
      key: 'OEBPS/images/a.png',
      path: 'OEBPS/images/a.png',
    })
    expect(resolveSource('./a%20b.png#x', 'OEBPS')).toMatchObject({ path: 'OEBPS/a b.png' })
    expect(resolveSource(' a.png?v=2 ', '')).toMatchObject({ path: 'a.png' })
  })

  it('names what it can’t read', () => {
    expect(resolveSource('https://example.com/a.png', '')).toMatchObject({ problem: 'remote' })
    expect(resolveSource('//cdn.example/a.png', '')).toMatchObject({ problem: 'remote' })
    expect(resolveSource('data:image/png;base64,AAAA', '')).toMatchObject({ problem: 'unreadable' })
    expect(resolveSource('file:///etc/passwd', '')).toMatchObject({ problem: 'missing' })
    expect(resolveSource('#only-a-fragment', '')).toMatchObject({ problem: 'missing' })
  })
})

describe('pictureSources', () => {
  it('lists each image’s src and each SVG image’s href once', () => {
    const root = parseHtml(
      '<p><img src="a.png"/><img src=" a.png "/><img alt="none"/></p><svg><image href="b.jpg"/></svg>' +
        '<svg><image xlink:href="c.jpg"/></svg>',
    )
    expect(pictureSources(root)).toEqual(['a.png', 'b.jpg', 'c.jpg'])
  })
})

describe('PicturePool', () => {
  it('reads each picture once, with its type and size, and numbers them in the order they are met', async () => {
    const { entry, reads } = archive({ 'img/a.jpg': image('cover.jpg'), 'img/d.svg': svg })
    const pool = new PicturePool()
    await pool.load(['../img/a.jpg', 'https://x.example/b.png', '../img/missing.png', '../img/d.svg'], 'text', entry)
    await pool.load(['../img/a.jpg'], 'text', entry)
    const lookup = pool.lookup('text')
    expect(lookup.file('../img/a.jpg')).toBe(1)
    expect(lookup.file('./../img/a.jpg')).toBe(1)
    expect(lookup.size(1)).toEqual({ width: 400, height: 600 })
    expect(lookup.size(4)).toEqual({ width: 300, height: 150 })
    expect(reads).toEqual(['img/a.jpg', 'img/d.svg'])
    expect(pool.pictures.map((p) => ('problem' in p ? p.problem : p.type))).toEqual([
      'image/jpeg',
      'remote',
      'missing',
      'image/svg+xml',
    ])
  })

  it('keeps bytes it doesn’t know, and a file too large to read, as problems', async () => {
    const { entry, reads } = archive(
      { 'junk.png': image('not-an-image.jpg'), 'huge.png': image('wide.png') },
      { 'huge.png': MAX_PICTURE_SOURCE_BYTES + 1 },
    )
    const pool = new PicturePool()
    await pool.load(['junk.png', 'huge.png'], '', entry)
    expect(pool.pictures).toEqual([
      { key: 'junk.png', problem: 'unreadable' },
      { key: 'huge.png', problem: 'large' },
    ])
    expect(reads).toEqual(['junk.png'])
  })

  it('numbers inline diagrams by their text, and finds unread paths missing', () => {
    const pool = new PicturePool()
    const lookup = pool.lookup('')
    const text = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"></svg>'
    expect(lookup.svg(text)).toBe(1)
    expect(lookup.svg(text)).toBe(1)
    expect(lookup.size(1)).toEqual({ width: 40, height: 20 })
    expect(lookup.file('a.png')).toBe(2)
    expect(lookup.file('https://example.com/a.png')).toBe(3)
    expect(lookup.size(2)).toBeNull()
    expect(pool.pictures.slice(1)).toEqual([
      { key: 'a.png', problem: 'missing' },
      { key: 'https://example.com/a.png', problem: 'remote' },
    ])
  })
})
