import { useCallback, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { PageRoot } from '~/client/features/reader/Page'
import { mount } from '~/client/testing/mount'
import { SelectionToolbar } from './SelectionToolbar'

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }
/** The toolbar's height and the gap it keeps from the selection and the screen's edges, as SelectionToolbar.tsx has them. */
const BAR_H = 40
const GAP = 8
const PAGE_PATH = '/read/essays/self-reliance'
const SENTENCE = 'Whoso would be a man must be a nonconformist.'
const WORD = 'nonconformist'
const ACTIONS = ['Highlight', 'Note', 'Ask about this', 'Explain', 'Look up', 'Read aloud from here']

/** A page of the book with the toolbar over it, the way the Reader mounts it, with its line `offsetTop` px down. */
function ReadingPage({ offsetTop, align }: { offsetTop: number; align: 'left' | 'center' | 'right' }) {
  const area = useRef<HTMLDivElement>(null)
  const rootOf = useCallback((node: Node): PageRoot | null => {
    const el = area.current
    return el?.contains(node) ? { el, path: PAGE_PATH } : null
  }, [])
  return (
    <>
      <div ref={area} style={{ margin: 0, paddingTop: offsetTop, textAlign: align }}>
        <p style={{ margin: 0 }}>{SENTENCE}</p>
      </div>
      <SelectionToolbar
        area={area}
        rootOf={rootOf}
        highlighting
        onAsk={vi.fn()}
        onExplain={vi.fn()}
        explainDisabled={false}
        onHighlight={vi.fn()}
        onReadAloud={vi.fn()}
        lang="en"
        onLookUp={vi.fn()}
      />
    </>
  )
}

/**
 * The toolbar has no role of its own: it's a strip of buttons, found by its test id. Each test also finds the buttons
 * in it by role and name.
 */
const toolbar = page.getByTestId('selection-toolbar')

/** Selects the word, as a reader would by dragging over it, and returns where the selection sits on screen. */
function selectWord(): DOMRect {
  const paragraph = document.querySelector('p')
  const text = paragraph?.firstChild
  if (!(text instanceof Text)) throw new Error('The page has no text to select')
  const start = SENTENCE.indexOf(WORD)
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(text, start + WORD.length)
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  return range.getBoundingClientRect()
}

/**
 * Where the toolbar sits on screen. It places itself with an inline top, left and max-width, and is always `BAR_H` tall.
 * Browser tests don't load Tailwind, so its `fixed` class does nothing here: the box is read from those inline
 * values, which with the app's CSS are the toolbar's place on screen. `right` uses the max-width, the widest it can be.
 */
function toolbarBox() {
  const style = (toolbar.element() as HTMLElement).style
  const left = Number.parseFloat(style.left)
  const top = Number.parseFloat(style.top)
  const width = Number.parseFloat(style.maxWidth)
  return { left, top, width, right: left + width, bottom: top + BAR_H }
}

/** Says the screen is a touch screen, so `(pointer: coarse)` matches, as it does on a phone. */
function touchScreen() {
  const realMatchMedia = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const list = realMatchMedia(query)
    if (query === '(pointer: coarse)') Object.defineProperty(list, 'matches', { value: true })
    return list
  })
}

async function expectEveryAction() {
  for (const name of ACTIONS) await expect.element(toolbar.getByRole('button', { name, exact: true })).toBeVisible()
}

function expectOnScreen(box: ReturnType<typeof toolbarBox>) {
  expect(box.left).toBeGreaterThanOrEqual(GAP)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth - GAP)
  expect(box.top).toBeGreaterThanOrEqual(GAP)
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight - GAP)
}

describe('SelectionToolbar at desktop width', () => {
  it('opens above a selection made with a mouse, wide enough for every label, and inside the screen', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    mount(<ReadingPage offsetTop={400} align="right" />)
    const selected = selectWord()
    await expect.element(toolbar).toBeInTheDocument()
    await expectEveryAction()
    const box = toolbarBox()
    /** Room for all six labels: 660px for a passage with Read aloud, and 110px more for Look up. */
    expect(box.width).toBe(770)
    expect(box.bottom).toBeLessThanOrEqual(selected.top)
    expectOnScreen(box)
  })
})

describe('SelectionToolbar at phone width', () => {
  it('narrows to the screen less 8px each side, and keeps every action', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    mount(<ReadingPage offsetTop={400} align="center" />)
    selectWord()
    await expect.element(toolbar).toBeInTheDocument()
    await expectEveryAction()
    const box = toolbarBox()
    expect(box.width).toBe(PHONE.width - 2 * GAP)
    expect(box.left).toBe(GAP)
    expectOnScreen(box)
  })

  it('opens below a selection made by touch, clear of the menu the phone shows above it', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    touchScreen()
    mount(<ReadingPage offsetTop={400} align="center" />)
    const selected = selectWord()
    await expect.element(toolbar).toBeInTheDocument()
    const box = toolbarBox()
    expect(box.top).toBeGreaterThanOrEqual(selected.bottom + GAP)
    expectOnScreen(box)
  })

  it('opens above a touch selection at the foot of the screen, so it never falls off the bottom', async () => {
    await page.viewport(PHONE.width, PHONE.height)
    touchScreen()
    mount(<ReadingPage offsetTop={PHONE.height - 40} align="center" />)
    const selected = selectWord()
    expect(selected.bottom).toBeLessThanOrEqual(PHONE.height)
    await expect.element(toolbar).toBeInTheDocument()
    const box = toolbarBox()
    expect(box.bottom).toBeLessThanOrEqual(selected.top)
    expectOnScreen(box)
  })
})

describe('SelectionToolbar when the window changes size', () => {
  it('narrows to fit when a desktop window shrinks to phone width with a selection open', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
    mount(<ReadingPage offsetTop={400} align="center" />)
    selectWord()
    await expect.element(toolbar).toBeInTheDocument()
    expect(toolbarBox().width).toBe(770)
    await page.viewport(PHONE.width, PHONE.height)
    await expect.poll(() => toolbarBox().width).toBe(PHONE.width - 2 * GAP)
    expectOnScreen(toolbarBox())
  })
})
