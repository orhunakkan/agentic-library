import { SITE_NAME, SITE_TAGLINE } from '../lib/site.ts'

export const THEME_COLOR = '#0B0D17'
export const MANIFEST_PATH = '/manifest.webmanifest'

export interface ManifestIcon {
  src: string
  sizes: string
  type: 'image/png'
  purpose: 'any' | 'maskable'
}

export const APP_ICONS: readonly ManifestIcon[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

export const APPLE_TOUCH_ICON = { src: '/apple-touch-icon.png', size: 180 } as const

export interface WebAppManifest {
  id: string
  name: string
  short_name: string
  description: string
  lang: string
  dir: 'ltr' | 'rtl' | 'auto'
  start_url: string
  scope: string
  display: 'standalone'
  background_color: string
  theme_color: string
  categories: string[]
  icons: ManifestIcon[]
}

export function webManifest(): WebAppManifest {
  return {
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
    icons: APP_ICONS.map((icon) => ({ ...icon })),
  }
}
