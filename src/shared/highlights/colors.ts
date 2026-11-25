import { isOneOf } from '../lib/json-shape.ts'

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
  return isOneOf(value, HIGHLIGHT_COLORS)
}

export function knownColor(value: string): HighlightColor {
  return isHighlightColor(value) ? value : DEFAULT_COLOR
}
