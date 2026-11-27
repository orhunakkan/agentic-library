import { describe, expect, it } from 'vitest'
import { renderCoverSvg, wrapTitle } from '~/shared/content/cover'
import { metaFor } from '../../../fixtures/books'

describe('wrapTitle', () => {
  it('breaks long titles into balanced lines', () => {
    expect(wrapTitle('The Confessions of Al Ghazzali', 16)).toEqual(['The Confessions', 'of Al Ghazzali'])
  })

  it('keeps short titles on one line', () => {
    expect(wrapTitle('Walden', 14)).toEqual(['Walden'])
  })
})

describe('renderCoverSvg', () => {
  it('produces a 600×900 SVG with the title and author', () => {
    const svg = renderCoverSvg(metaFor('walden'))
    expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 600 900"/)
    expect(svg).toContain('>Walden<')
    expect(svg).toContain('>AUTHOR<')
  })

  it('escapes markup in titles', () => {
    const svg = renderCoverSvg({ ...metaFor('walden'), title: 'Tom & <Jerry>' })
    expect(svg).toContain('Tom &amp; &lt;Jerry&gt;')
    expect(svg).not.toContain('<Jerry>')
  })
})
