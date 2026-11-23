import { describe, expect, it } from 'vitest'
import { type ContentImageSources, serveContentImage } from './content-images'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const FILE = 'abcdef012345.png'
const sources: ContentImageSources = {
  isBook: async (slug) => slug === 'figure-book',
  image: async (slug, file) => (slug === 'figure-book' && file === FILE ? new Uint8Array(PNG) : null),
}
const get = (slug: string, file: string) => serveContentImage(slug, file, sources)

describe('serveContentImage', () => {
  it('looks a picture up in the content folders by default', async () => {
    expect((await serveContentImage('pride-and-prejudice', FILE)).status).toBe(404)
    expect((await serveContentImage('no-such-book', FILE)).status).toBe(404)
  })

  it('serves a picture by its hashed name, immutable, with the type its extension names', async () => {
    const res = await get('figure-book', FILE)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-length')).toBe('4')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })

  it('names each type by its extension', async () => {
    for (const [ext, type] of [
      ['jpg', 'image/jpeg'],
      ['webp', 'image/webp'],
      ['gif', 'image/gif'],
    ]) {
      const any: ContentImageSources = { isBook: async () => true, image: async () => new Uint8Array(PNG) }
      const res = await serveContentImage('figure-book', `abcdef012345.${ext}`, any)
      expect(res.headers.get('content-type')).toBe(type)
    }
  })

  it.each([
    ['a bad name', 'figure-book', 'picture.png'],
    ['a short hash', 'figure-book', 'abcdef01.png'],
    ['an upper-case hash', 'figure-book', 'ABCDEF012345.png'],
    ['an SVG', 'figure-book', 'abcdef012345.svg'],
    ['a path out of the folder', 'figure-book', '../abcdef012345.png'],
    ['a slug with a path', '../figure-book', FILE],
    ['a private book', 'u-0f8e2a9c-1b3d-4c5e-8f70-123456789abc', FILE],
    ['an unknown slug', 'other-book', FILE],
    ['a file the book lacks', 'figure-book', 'ffffff012345.png'],
  ])('answers 404 for %s', async (_, slug, file) => {
    const res = await get(slug, file)
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
