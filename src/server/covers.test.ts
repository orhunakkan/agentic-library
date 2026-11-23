import { describe, expect, it } from 'vitest'
import { privateBookSlug } from '~/shared/content/book-slug'
import type { BookMeta } from '~/shared/content/schema'
import { type CoverSources, serveCover } from './covers'

const HASH = `abcdef12${'0'.repeat(56)}`
const base: BookMeta = {
  id: '1',
  slug: 'with-cover',
  title: 'With Cover',
  author: 'Ada',
  seriesSlug: 's',
  order: 1,
  shortDescription: '',
  language: 'en',
  kind: 'chapter',
  cover: { background: ['#000000', '#111111'], ink: '#ffffff', motif: 'rings' },
  chapterCount: 1,
  source: { name: 'x', url: 'https://example.com', license: 'CC0' },
}
const withCover: BookMeta = {
  ...base,
  coverImage: { file: 'with-cover.jpg', type: 'image/jpeg', width: 600, height: 900, hash: HASH },
}
const plain: BookMeta = { ...base, id: '2', slug: 'plain', title: 'Plain' }
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

const sources: CoverSources = {
  book: async (slug) => [withCover, plain].find((b) => b.slug === slug),
  image: async (slug) => (slug === 'with-cover' ? new Uint8Array(BYTES) : null),
}

const get = (file: string) => serveCover(file, sources)

describe('serveCover', () => {
  it('serves the image at its hashed address, immutable, with its type', async () => {
    const res = await get('with-cover-abcdef12.jpg')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES)
  })

  it('redirects a stale hash or extension to the current address', async () => {
    for (const stale of ['with-cover-00000000.jpg', 'with-cover-abcdef12.png']) {
      const res = await get(stale)
      expect(res.status, stale).toBe(302)
      expect(res.headers.get('location')).toBe('/covers/with-cover-abcdef12.jpg')
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    }
  })

  it('redirects the bare slug to the image, or to the generated cover', async () => {
    expect((await get('with-cover')).headers.get('location')).toBe('/covers/with-cover-abcdef12.jpg')
    const res = await get('plain')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/covers/plain.svg')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('still draws the generated cover as an SVG for every book', async () => {
    for (const slug of ['plain', 'with-cover']) {
      const res = await get(`${slug}.svg`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
      expect(await res.text()).toContain('<svg')
    }
  })

  it('answers 404 for a book without an image, an unknown or private slug, a bad name and a missing file', async () => {
    const missingFile: CoverSources = { ...sources, image: async () => null }
    expect((await serveCover('with-cover-abcdef12.jpg', missingFile)).status).toBe(404)
    for (const file of [
      'plain-abcdef12.jpg',
      'nobody-abcdef12.jpg',
      'nobody',
      'nobody.svg',
      privateBookSlug('0b9f6a3c-2d5e-4f1a-9c8b-7e6d5c4b3a21'),
      'u-0b9f6a3c-2d5e-4f1a-9c8b-7e6d5c4b3a21.svg',
      'With-Cover',
      '../secret',
      'with-cover-abcdef12.gif',
      'with-cover.jpg',
      '',
    ])
      expect((await get(file)).status, file).toBe(404)
  })

  it('reads the real catalogue by default', async () => {
    const res = await serveCover('pride-and-prejudice')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/^\/covers\/pride-and-prejudice-[0-9a-f]{8}\.jpg$/)
    const image = await serveCover((res.headers.get('location') as string).slice('/covers/'.length))
    expect(image.status).toBe(200)
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(100_000)
  })
})
