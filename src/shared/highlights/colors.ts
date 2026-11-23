export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export const DEFAULT_COLOR: HighlightColor = 'yellow'

export const COLOR_NAMES: Record<HighlightColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
}

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && (HIGHLIGHT_COLORS as readonly string[]).includes(value)
}

export function knownColor(value: string): HighlightColor {
  return isHighlightColor(value) ? value : DEFAULT_COLOR
}
