import { describe, expect, it } from 'vitest'
import { decodePage, pictureAddresses } from './page'

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)))

describe('decodePage', () => {
  it('takes the header’s charset first', () => {
    expect(decodePage(bytes('caf', [0xe9]), 'text/html; charset=windows-1252')).toBe('café')
    expect(decodePage(bytes('caf', [0xe9]), 'text/html; charset="ISO-8859-1"')).toBe('café')
  })
  it('then a byte-order mark', () => {
    expect(decodePage(bytes([0xef, 0xbb, 0xbf], 'caf', [0xc3, 0xa9]), 'text/html')).toBe('café')
    expect(decodePage(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]), null)).toBe('hi')
    expect(decodePage(new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]), null)).toBe('hi')
  })
  it('then a meta charset or http-equiv in the first 2 KB', () => {
    expect(decodePage(bytes('<meta charset="windows-1252"><p>caf', [0xe9]), 'text/html')).toBe(
      '<meta charset="windows-1252"><p>café',
    )
    const equiv = '<meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">'
    expect(decodePage(bytes(equiv, [0x93, 0xfa, 0x96, 0x7b]), null)).toBe(`${equiv}日本`)
    const late = `${' '.repeat(2100)}<meta charset="windows-1252">`
    expect(decodePage(bytes(late, [0xc3, 0xa9]), null)).toBe(`${late}é`)
  })
  it('falls back to UTF-8, for no label or an unknown one, without failing on bad bytes', () => {
    expect(decodePage(bytes([0xc3, 0xa9]), null)).toBe('é')
    expect(decodePage(bytes([0xc3, 0xa9]), 'text/html; charset=klingon')).toBe('é')
    expect(decodePage(bytes([0xff]), null)).toBe('�')
  })
})

describe('pictureAddresses', () => {
  const base = 'https://news.test/2026/story/'
  it('lists every address, resolved and without repeats', () => {
    const html = `
      <img src="a.jpg"><img src="/b.png" srcset="b-400.png 400w, b-800.png 800w">
      <img data-src="lazy.webp" data-srcset="lazy-2x.webp 2x" data-original="//cdn.test/o.gif" data-lazy-src="l.jpg">
      <picture><source srcset="https://cdn.test/w_400,h_300/p.jpg 400w"><img src="a.jpg"></picture>
      <img src="data:image/png;base64,AAAA"><img src="javascript:alert(1)"><img src=""><img src="http://[bad">`
    expect(pictureAddresses(html, base)).toEqual([
      'https://news.test/2026/story/a.jpg',
      'https://news.test/b.png',
      'https://news.test/2026/story/b-400.png',
      'https://news.test/2026/story/b-800.png',
      'https://news.test/2026/story/lazy.webp',
      'https://cdn.test/o.gif',
      'https://news.test/2026/story/l.jpg',
      'https://news.test/2026/story/lazy-2x.webp',
      'https://cdn.test/w_400,h_300/p.jpg',
    ])
  })
  it('keeps at most 500', () => {
    const html = Array.from({ length: 600 }, (_, i) => `<img src="p${i}.jpg">`).join('')
    expect(pictureAddresses(html, base)).toHaveLength(500)
  })
})
