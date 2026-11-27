import { MB } from '../import/limits.ts'

/** The largest picture Folio shows from a repository; a bigger one is a file too large to show. */
export const PICTURE_MAX_BYTES = 5 * MB

/** The most pictures a download keeps, and the most bytes of them; past either, it keeps none. */
export const MAX_OFFLINE_PICTURES = 200
export const MAX_OFFLINE_PICTURE_BYTES = 30 * MB

const PICTURE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'])

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isPictureName = (name: string) => PICTURE_EXTENSIONS.has(extensionOf(name))
