import { describe, expect, it } from 'vitest'
import { SITE_NAME, SITE_TAGLINE } from '../lib/site'
import { APP_ICONS, THEME_COLOR, webManifest } from './manifest'

describe('webManifest', () => {
  const manifest = webManifest()

  it('has every field Folio decided on', () => {
    expect(manifest).toEqual({
      id: '/library',
      name: SITE_NAME,
      short_name: SITE_NAME,
      description: SITE_TAGLINE,
      lang: 'en',
      dir: 'ltr',
      start_url: '/library',
      scope: '/',
      display: 'standalone',
      background_color: THEME_COLOR,
      theme_color: THEME_COLOR,
      categories: ['books', 'education'],
      icons: APP_ICONS,
    })
    expect(manifest.name).toBe('Folio')
    expect(THEME_COLOR).toBe('#0B0D17')
  })

  it('opens inside its own scope', () => {
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true)
  })

  it('lists a 192 and a 512 for any purpose and a maskable 512, all PNGs at the root', () => {
    const icons = manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)
    expect(icons).toEqual(['192x192 any', '512x512 any', '512x512 maskable'])
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(icon.src).toMatch(/^\/[a-z0-9/-]+\.png$/)
    }
  })

  it('hands out copies, so a caller can’t change the shared icon list', () => {
    const first = webManifest()
    for (const icon of first.icons) icon.src = '/changed.png'
    first.icons.pop()
    expect(webManifest().icons).toEqual(APP_ICONS)
    expect(APP_ICONS.map((i) => i.src)).not.toContain('/changed.png')
  })
})
