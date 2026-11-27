import { describe, expect, it } from 'vitest'
import { QUOTE_MAX } from '~/client/features/ask/ask-client'
import { selectionIn, toolbarTop, toolbarWidth } from '~/client/features/highlights/SelectionToolbar'

const inside = { name: 'text in the page' }
const outside = { name: 'text in the panel' }
const area = { contains: (node: unknown) => node === inside } as unknown as HTMLElement

function selection(text: string, node: unknown, collapsed = false) {
  return {
    isCollapsed: collapsed,
    rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: node }),
    toString: () => text,
  } as unknown as Selection
}

describe('selectionIn', () => {
  it('gives the selected text inside the reading area, with whitespace collapsed', () => {
    expect(selectionIn(area, selection('  A closure\n   keeps   its scope. ', inside))).toBe(
      'A closure keeps its scope.',
    )
  })

  it('ignores selections elsewhere, empty ones and a missing area', () => {
    expect(selectionIn(area, selection('In the panel', outside))).toBeNull()
    expect(selectionIn(area, selection('', inside, true))).toBeNull()
    expect(selectionIn(area, selection('   ', inside))).toBeNull()
    expect(selectionIn(null, selection('x', inside))).toBeNull()
    expect(selectionIn(area, null)).toBeNull()
  })

  it('cuts a long selection to 1,000 characters', () => {
    expect(selectionIn(area, selection('é'.repeat(QUOTE_MAX + 50), inside))).toHaveLength(QUOTE_MAX)
  })
})

describe('toolbarTop', () => {
  const screen = { viewportHeight: 800, playerHeight: 0 }

  it('goes above the selection with a mouse, and below it when there is no room above', () => {
    expect(toolbarTop({ top: 300, bottom: 320 }, { ...screen, touch: false })).toBe(252)
    expect(toolbarTop({ top: 20, bottom: 40 }, { ...screen, touch: false })).toBe(48)
  })

  it('goes below the selection on touch, clear of the system menu', () => {
    expect(toolbarTop({ top: 300, bottom: 320 }, { ...screen, touch: true })).toBe(328)
  })

  it('never goes under the player dock: above the selection instead, or just over the dock', () => {
    const docked = { viewportHeight: 800, playerHeight: 74, touch: true }
    expect(toolbarTop({ top: 680, bottom: 700 }, docked)).toBe(632)
    expect(toolbarTop({ top: 10, bottom: 760 }, docked)).toBe(678)
    expect(toolbarTop({ top: 300, bottom: 320 }, docked)).toBe(328)
  })
})

describe('toolbarWidth', () => {
  it('makes room for the labels of the buttons that show', () => {
    const off = { lookup: false }
    expect(toolbarWidth({ passage: true, readAloud: true, ...off }, 1440)).toBe(660)
    expect(toolbarWidth({ passage: true, readAloud: false, ...off }, 1440)).toBe(460)
    expect(toolbarWidth({ passage: false, readAloud: true, ...off }, 1440)).toBe(280)
    expect(toolbarWidth({ passage: false, readAloud: false, ...off }, 1440)).toBe(280)
  })

  it('makes room for Look up or Translate when it shows', () => {
    expect(toolbarWidth({ passage: true, readAloud: true, lookup: true }, 1440)).toBe(770)
    expect(toolbarWidth({ passage: true, readAloud: false, lookup: true }, 1440)).toBe(570)
    expect(toolbarWidth({ passage: false, readAloud: true, lookup: true }, 1440)).toBe(390)
    expect(toolbarWidth({ passage: false, readAloud: false, lookup: true }, 1440)).toBe(390)
  })

  it('never goes wider than the viewport less 8px either side', () => {
    expect(toolbarWidth({ passage: true, readAloud: true, lookup: true }, 360)).toBe(344)
    expect(toolbarWidth({ passage: true, readAloud: false, lookup: false }, 360)).toBe(344)
    expect(toolbarWidth({ passage: false, readAloud: false, lookup: true }, 360)).toBe(344)
    expect(toolbarWidth({ passage: false, readAloud: false, lookup: false }, 360)).toBe(280)
    expect(toolbarWidth({ passage: false, readAloud: false, lookup: false }, 280)).toBe(264)
  })
})
