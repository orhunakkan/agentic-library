import { describe, expect, it } from 'vitest'
import { keyTurn, type PageKey, type ReaderOverlays, TYPING_OR_DIALOG } from './page-keys'

const NONE_OPEN: ReaderOverlays = {
  settings: false,
  contents: false,
  footnote: false,
  askSheet: false,
  popover: false,
  lookup: false,
  picture: false,
  runCode: false,
}

/** A key target whose `closest` answers as an element inside a field or dialog would, or as one outside. */
const targetIn = (typingOrDialog: boolean) =>
  ({
    closest: (selectors: string) => (typingOrDialog && selectors === TYPING_OR_DIALOG ? {} : null),
  }) as unknown as EventTarget

const press = (key: string, extra: Partial<PageKey> = {}): PageKey => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  target: targetIn(false),
  ...extra,
})

describe('keyTurn', () => {
  it('turns to the next page on ArrowRight and the previous on ArrowLeft', () => {
    expect(keyTurn(press('ArrowRight'), NONE_OPEN)).toBe('next')
    expect(keyTurn(press('ArrowLeft'), NONE_OPEN)).toBe('prev')
  })

  it('ignores keys other than the left and right arrows', () => {
    for (const key of ['ArrowUp', 'ArrowDown', ' ', 'Enter', 'PageDown', 'j'])
      expect(keyTurn(press(key), NONE_OPEN), key).toBeNull()
  })

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const)('ignores an arrow pressed with %s', (modifier) => {
    expect(keyTurn(press('ArrowRight', { [modifier]: true }), NONE_OPEN)).toBeNull()
    expect(keyTurn(press('ArrowLeft', { [modifier]: true }), NONE_OPEN)).toBeNull()
  })

  it.each(Object.keys(NONE_OPEN) as (keyof ReaderOverlays)[])('ignores the arrows while %s is open', (overlay) => {
    const overlays = { ...NONE_OPEN, [overlay]: true }
    expect(keyTurn(press('ArrowRight'), overlays)).toBeNull()
    expect(keyTurn(press('ArrowLeft'), overlays)).toBeNull()
  })

  it('ignores the arrows while typing in a field or working in a dialog', () => {
    expect(keyTurn(press('ArrowRight', { target: targetIn(true) }), NONE_OPEN)).toBeNull()
    expect(keyTurn(press('ArrowLeft', { target: targetIn(true) }), NONE_OPEN)).toBeNull()
  })

  it('turns when the key has no target', () => {
    expect(keyTurn(press('ArrowRight', { target: null }), NONE_OPEN)).toBe('next')
  })

  it('counts form fields, editable text and dialogs as typing or dialog', () => {
    for (const selector of ['input', 'textarea', 'select', '[contenteditable="true"]', '[role="dialog"]', 'dialog'])
      expect(TYPING_OR_DIALOG, selector).toContain(selector)
  })
})
