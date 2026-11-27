import { describe, expect, it } from 'vitest'
import { appIconSvg, ICON_LIME, OUTER_RADIUS } from '~/shared/pwa/app-icon'
import { THEME_COLOR } from '~/shared/pwa/manifest'

const radii = (svg: string) => [...svg.matchAll(/<circle [^>]*r="([\d.]+)"/g)].map((m) => Number(m[1]))

describe('appIconSvg', () => {
  for (const size of [180, 192, 512]) {
    it(`draws a ${size}px square with the logo inside the maskable safe zone`, () => {
      const svg = appIconSvg(size)
      expect(svg).toContain(`width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"`)
      expect(svg).toContain(`<rect width="${size}" height="${size}" fill="${THEME_COLOR}"/>`)
      const [outer, inner] = radii(svg)
      expect(outer).toBeLessThanOrEqual(0.4 * size)
      expect(outer).toBeCloseTo(OUTER_RADIUS * size, 2)
      expect((outer ?? 0) / (inner ?? 1)).toBeCloseTo(15 / 6, 2)
      expect(svg).toContain(`cx="${size / 2}" cy="${size / 2}"`)
    })
  }

  it('uses only the design’s navy and lime, and no text', () => {
    const svg = appIconSvg(512)
    expect(new Set(svg.match(/fill="[^"]+"/g))).toEqual(new Set([`fill="${THEME_COLOR}"`, `fill="${ICON_LIME}"`]))
    expect(ICON_LIME).toBe('#B8F35C')
    expect(svg).not.toContain('<text')
  })
})
