import { readFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'
import { metaFor } from '../../tests/fixtures/books'
import { renderOgSvg } from './og'

describe('renderOgSvg', () => {
  it('is a 1200×630 card with eyebrow, title and subtitle', () => {
    const svg = renderOgSvg({ eyebrow: 'Folio', title: 'Library', subtitle: '21 books to read and listen to' })
    expect(svg).toMatch(/^<svg[^>]+width="1200" height="630"/)
    expect(svg).toContain('>FOLIO<')
    expect(svg).toContain('>Library<')
    expect(svg).toContain('21 books to read and listen to')
  })

  it('embeds the book cover when given one', () => {
    const svg = renderOgSvg({ eyebrow: 'Book', title: 'Walden', subtitle: 'Thoreau', book: metaFor('walden') })
    expect(svg).toContain('<svg x="')
  })

  it('embeds a book’s own cover image in place of the generated one, clipped to its frame', () => {
    const image = { type: 'image/jpeg' as const, base64: 'AAAA', width: 400, height: 600 }
    const svg = renderOgSvg({ eyebrow: 'Book', title: 'Walden', subtitle: '', book: { ...metaFor('walden'), image } })
    expect(svg).toContain('href="data:image/jpeg;base64,AAAA"')
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice" clip-path="url(#cover-clip)"')
    expect(svg).not.toContain('<svg x="')
  })

  it('is drawn by resvg: the cover area shows the embedded JPEG, not the generated cover', () => {
    const jpeg = readFileSync(new URL('../../tests/fixtures/images/cover.jpg', import.meta.url)).toString('base64')
    const card = { eyebrow: 'Book', title: 'Walden', subtitle: '' }
    const pixel = (svg: string) => {
      const rendered = new Resvg(svg).render()
      const at = (227 * rendered.width + 998) * 4
      return [...rendered.pixels.subarray(at, at + 3)]
    }
    const image = { type: 'image/jpeg' as const, base64: jpeg, width: 400, height: 600 }
    const drawn = pixel(renderOgSvg({ ...card, book: { ...metaFor('walden'), image } }))
    const generated = pixel(renderOgSvg({ ...card, book: metaFor('walden') }))
    expect(Math.abs((drawn[0] ?? 0) - 49)).toBeLessThan(16)
    expect(Math.abs((drawn[1] ?? 0) - 103)).toBeLessThan(16)
    expect(Math.abs((drawn[2] ?? 0) - 129)).toBeLessThan(16)
    expect(drawn).not.toEqual(generated)
  })

  it('uses the Midnight palette, with an amber eyebrow on warm cards', () => {
    const svg = renderOgSvg({ eyebrow: 'Series', title: 'Walden', subtitle: '' })
    expect(svg).toContain('stop-color="#0B0D17"')
    expect(svg).toContain('stop-color="#1F2550"')
    expect(svg).toContain('<text x="80" y="160" fill="#B8F35C"')
    expect(svg).toContain('<circle cx="89" cy="551" r="9" fill="#B8F35C"/>')
    expect(renderOgSvg({ eyebrow: 'Series', title: 'Walden', subtitle: '', warm: true })).toContain(
      '<text x="80" y="160" fill="#FCD34D"',
    )
  })

  it('escapes text', () => {
    expect(renderOgSvg({ eyebrow: 'a', title: 'Tom & <Jerry>', subtitle: '' })).toContain('Tom &amp; &lt;Jerry&gt;')
  })
})
