import type { Direction } from './Page'

/** Where a key press is typing, or belongs to a dialog, rather than to the page. */
export const TYPING_OR_DIALOG =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], dialog'

/** The parts of a `KeyboardEvent` that decide whether it turns the page. */
export type PageKey = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'target'>

/** Which of the reader's overlays are open. Any of them takes the arrow keys from the page. */
export interface ReaderOverlays {
  settings: boolean
  contents: boolean
  footnote: boolean
  askSheet: boolean
  popover: boolean
  lookup: boolean
  picture: boolean
  runCode: boolean
}

/** The page an arrow key turns to, or `null` when a modifier, an open overlay or a focused field keeps it. */
export function keyTurn(press: PageKey, overlays: ReaderOverlays): Direction | null {
  if (
    press.altKey ||
    press.ctrlKey ||
    press.metaKey ||
    press.shiftKey ||
    overlays.settings ||
    overlays.contents ||
    overlays.footnote ||
    overlays.askSheet ||
    overlays.popover ||
    overlays.lookup ||
    overlays.picture ||
    overlays.runCode
  )
    return null
  if ((press.target as HTMLElement | null)?.closest(TYPING_OR_DIALOG)) return null
  if (press.key === 'ArrowRight') return 'next'
  if (press.key === 'ArrowLeft') return 'prev'
  return null
}
