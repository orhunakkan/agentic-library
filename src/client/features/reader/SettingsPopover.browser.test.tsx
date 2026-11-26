import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { mount } from '~/client/testing/mount'
import { DEFAULT_PREFS, FONT_SIZES, type ReaderPrefs } from './prefs'
import { SettingsPopover } from './SettingsPopover'

function Harness({
  initial,
  update,
  showPanel,
  syncs,
}: {
  initial: ReaderPrefs
  update: (patch: Partial<ReaderPrefs>) => void
  showPanel: boolean
  syncs: boolean
}) {
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState(initial)
  return (
    <SettingsPopover
      tone="default"
      prefs={prefs}
      update={(patch) => {
        update(patch)
        setPrefs((current) => ({ ...current, ...patch }))
      }}
      showPanel={showPanel}
      syncs={syncs}
      open={open}
      onOpenChange={setOpen}
      trigger={<button type="button">Settings</button>}
    />
  )
}

const trigger = page.getByRole('button', { name: 'Settings' })
const dialog = page.getByRole('dialog', { name: 'Reading settings' })
const group = (name: string) => dialog.getByRole('radiogroup', { name })

async function openSettings({
  prefs = {},
  showPanel = true,
  syncs = false,
}: {
  prefs?: Partial<ReaderPrefs>
  showPanel?: boolean
  syncs?: boolean
} = {}) {
  const update = vi.fn<(patch: Partial<ReaderPrefs>) => void>()
  mount(<Harness initial={{ ...DEFAULT_PREFS, ...prefs }} update={update} showPanel={showPanel} syncs={syncs} />)
  await trigger.click()
  await expect.element(dialog).toBeVisible()
  return update
}

describe('SettingsPopover', () => {
  it('stays closed until Settings is pressed', async () => {
    mount(<Harness initial={DEFAULT_PREFS} update={vi.fn()} showPanel syncs={false} />)
    await expect.element(trigger).toBeVisible()
    await expect.element(dialog).not.toBeInTheDocument()
  })

  it('opens the reading settings when Settings is pressed', async () => {
    await openSettings()
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect.element(dialog).toHaveRole('dialog')
    await expect.element(dialog).toHaveAccessibleName('Reading settings')
  })

  it('opens with Enter on the focused Settings button', async () => {
    mount(<Harness initial={DEFAULT_PREFS} update={vi.fn()} showPanel syncs={false} />)
    ;(trigger.element() as HTMLButtonElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).toBeVisible()
  })

  it('closes on Escape and returns focus to the Settings button', async () => {
    await openSettings()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('closes on Escape from inside a control, and returns focus to the Settings button', async () => {
    await openSettings()
    await group('Theme').getByRole('radio', { name: 'Sepia' }).click()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('checks the current preferences when it opens', async () => {
    await openSettings({ prefs: { theme: 'sepia', font: 'geist', leading: 'relaxed', measure: 'wide' } })
    await expect.element(group('Theme').getByRole('radio', { name: 'Sepia' })).toBeChecked()
    await expect.element(group('Font').getByRole('radio', { name: 'Geist' })).toBeChecked()
    await expect.element(group('Line spacing').getByRole('radio', { name: 'Relaxed' })).toBeChecked()
    await expect.element(group('Page width').getByRole('radio', { name: 'Wide' })).toBeChecked()
    await expect.element(group('Reading mode').getByRole('radio', { name: 'Pages' })).toBeChecked()
  })

  it('changes the theme when a theme is chosen', async () => {
    const update = await openSettings()
    await group('Theme').getByRole('radio', { name: 'Dark' }).click()
    expect(update).toHaveBeenCalledExactlyOnceWith({ theme: 'dark' })
  })

  it('changes the font when a font is chosen', async () => {
    const update = await openSettings()
    await group('Font').getByRole('radio', { name: 'OpenDyslexic' }).click()
    expect(update).toHaveBeenCalledExactlyOnceWith({ font: 'opendyslexic' })
  })

  it('changes the line spacing when a spacing is chosen', async () => {
    const update = await openSettings()
    await group('Line spacing').getByRole('radio', { name: 'Compact' }).click()
    expect(update).toHaveBeenCalledExactlyOnceWith({ leading: 'compact' })
  })

  it('changes the page width when a width is chosen', async () => {
    const update = await openSettings()
    await group('Page width').getByRole('radio', { name: 'Narrow' }).click()
    expect(update).toHaveBeenCalledExactlyOnceWith({ measure: 'narrow' })
  })

  it('changes the reading mode when a mode is chosen', async () => {
    const update = await openSettings()
    await group('Reading mode').getByRole('radio', { name: 'Scroll' }).click()
    expect(update).toHaveBeenCalledExactlyOnceWith({ layout: 'scroll' })
  })

  it('moves to the next theme with the arrow keys', async () => {
    const update = await openSettings()
    ;(group('Theme').getByRole('radio', { name: 'Light' }).element() as HTMLInputElement).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(update).toHaveBeenCalledExactlyOnceWith({ theme: 'sepia' })
    await expect.element(group('Theme').getByRole('radio', { name: 'Sepia' })).toBeChecked()
  })

  it('steps the font size up and down one size at a time', async () => {
    const update = await openSettings({ prefs: { fontSize: 19 } })
    await dialog.getByRole('button', { name: 'Increase font size' }).click()
    expect(update).toHaveBeenLastCalledWith({ fontSize: 21 })
    /** Text a screen reader reads out as the size changes, so check it's in a polite live region. */
    const size = dialog.getByText('Font size 21 pixels')
    await expect.element(size).toBeInTheDocument()
    await expect.element(size).toHaveAttribute('aria-live', 'polite')
    await dialog.getByRole('button', { name: 'Decrease font size' }).click()
    expect(update).toHaveBeenLastCalledWith({ fontSize: 19 })
  })

  it('disables Increase font size at the largest size', async () => {
    await openSettings({ prefs: { fontSize: FONT_SIZES[FONT_SIZES.length - 1] } })
    await expect.element(dialog.getByRole('button', { name: 'Increase font size' })).toBeDisabled()
    await expect.element(dialog.getByRole('button', { name: 'Decrease font size' })).toBeEnabled()
  })

  it('disables Decrease font size at the smallest size', async () => {
    await openSettings({ prefs: { fontSize: FONT_SIZES[0] } })
    await expect.element(dialog.getByRole('button', { name: 'Decrease font size' })).toBeDisabled()
    await expect.element(dialog.getByRole('button', { name: 'Increase font size' })).toBeEnabled()
  })

  it('turns the contents panel off, and back on, with the Contents panel toggle', async () => {
    const update = await openSettings()
    const panel = dialog.getByRole('button', { name: /Contents panel/ })
    /** The On/Off badge runs into the name with no space ("Contents panelOn"), so only the start is pinned here. */
    await expect.element(panel).toHaveAccessibleName(/^Contents panel/)
    await expect.element(panel).toHaveAttribute('aria-pressed', 'true')
    await panel.click()
    expect(update).toHaveBeenLastCalledWith({ sidebarHidden: true })
    await expect.element(panel).toHaveAttribute('aria-pressed', 'false')
    await panel.click()
    expect(update).toHaveBeenLastCalledWith({ sidebarHidden: false })
  })

  it('leaves out the Contents panel toggle when there is no panel to show', async () => {
    await openSettings({ showPanel: false })
    await expect.element(dialog.getByRole('button', { name: /Contents panel/ })).not.toBeInTheDocument()
  })

  it('says which settings sync only when they sync', async () => {
    await openSettings({ syncs: true })
    /** Plain text in the dialog, with no role or name of its own to check. */
    await expect.element(dialog.getByText(/follow you to your other devices/)).toBeVisible()
  })

  it('says nothing about syncing when settings stay on this device', async () => {
    await openSettings({ syncs: false })
    await expect.element(dialog.getByText(/follow you to your other devices/)).not.toBeInTheDocument()
  })
})

/**
 * The gap the popover keeps from the screen's edges, its `collisionPadding`, less the pixel it may lose when its place
 * is rounded to whole pixels.
 */
const SCREEN_EDGE = 12 - 1

const rectOf = (element: Element) => element.getBoundingClientRect()
const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** Opens the settings from a Settings button where the Reader puts it: at the right end of the bar across the top. */
async function openFromTopRight() {
  mount(
    <div style={{ position: 'fixed', top: 8, right: 8 }}>
      <Harness initial={DEFAULT_PREFS} update={vi.fn()} showPanel syncs={false} />
    </div>,
  )
  await trigger.click()
  await expect.element(dialog).toBeVisible()
}

describe('SettingsPopover at phone and desktop widths', () => {
  it('opens below the Settings button at phone width, inside the left, top and bottom of the screen', async () => {
    await page.viewport(390, 844)
    await openFromTopRight()
    await expect.element(dialog).toHaveAttribute('data-side', 'bottom')
    const button = rectOf(trigger.element())
    await expect.poll(() => rectOf(dialog.element()).top).toBeGreaterThanOrEqual(button.bottom)
    const popup = rectOf(dialog.element())
    expect(popup.left).toBeGreaterThanOrEqual(SCREEN_EDGE)
    expect(popup.bottom).toBeLessThanOrEqual(window.innerHeight - SCREEN_EDGE)
    /**
     * The right edge isn't checked: the popover's width is its Tailwind class `w-[min(328px,calc(100vw-24px))]`, and
     * browser tests don't load Tailwind, so here it's as wide as its unstyled contents.
     */
    await expect.element(dialog.getByRole('button', { name: 'Increase font size' })).toBeVisible()
    await expect.element(dialog.getByRole('button', { name: /Contents panel/ })).toBeVisible()
  })

  it('stays inside the screen at desktop width, clear of the Settings button', async () => {
    await page.viewport(1280, 800)
    await openFromTopRight()
    const button = rectOf(trigger.element())
    await expect.poll(() => overlap(rectOf(dialog.element()), button)).toBe(false)
    const popup = rectOf(dialog.element())
    expect(popup.left).toBeGreaterThanOrEqual(SCREEN_EDGE)
    expect(popup.right).toBeLessThanOrEqual(window.innerWidth - SCREEN_EDGE)
    expect(popup.top).toBeGreaterThanOrEqual(SCREEN_EDGE)
    expect(popup.bottom).toBeLessThanOrEqual(window.innerHeight - SCREEN_EDGE)
  })
})
