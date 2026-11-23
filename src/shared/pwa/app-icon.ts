import { THEME_COLOR } from './manifest.ts'

export const ICON_LIME = '#B8F35C'
export const OUTER_RADIUS = 0.28
export const INNER_RADIUS = 0.112

const round = (n: number) => Math.round(n * 1000) / 1000

export function appIconSvg(size: number): string {
  const c = round(size / 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${THEME_COLOR}"/><circle cx="${c}" cy="${c}" r="${round(size * OUTER_RADIUS)}" fill="${ICON_LIME}"/><circle cx="${c}" cy="${c}" r="${round(size * INNER_RADIUS)}" fill="${THEME_COLOR}"/></svg>`
}
