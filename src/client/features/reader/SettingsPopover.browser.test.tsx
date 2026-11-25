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
    await expect.element(dialog.getByText('Font size 21 pixels')).toBeInTheDocument()
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
    await expect.element(dialog.getByText(/follow you to your other devices/)).toBeVisible()
  })

  it('says nothing about syncing when settings stay on this device', async () => {
    await openSettings({ syncs: false })
    await expect.element(dialog.getByText(/follow you to your other devices/)).not.toBeInTheDocument()
  })
})
