import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { mount } from '~/client/testing/mount'
import { MAX_NOTE, NOTE_COUNT_FROM } from '~/shared/highlights/limits'
import { NoteEditor } from './NoteEditor'

function renderEditor({
  initial = '',
  autoFocus = false,
  onSave = vi.fn(async (_note: string) => true),
}: {
  initial?: string
  autoFocus?: boolean
  onSave?: (note: string) => Promise<boolean>
} = {}) {
  const onCancel = vi.fn()
  mount(<NoteEditor initial={initial} autoFocus={autoFocus} onSave={onSave} onCancel={onCancel} />)
  return {
    onSave,
    onCancel,
    box: page.getByRole('textbox', { name: 'Note' }),
    save: page.getByRole('button', { name: 'Save' }),
    cancel: page.getByRole('button', { name: 'Cancel' }),
  }
}

describe('NoteEditor', () => {
  it('saves the note as typed when Save is pressed', async () => {
    const { box, save, onSave } = renderEditor()
    await box.fill('A line worth keeping')
    await save.click()
    expect(onSave).toHaveBeenCalledExactlyOnceWith('A line worth keeping')
  })

  it('cancels without saving when Cancel is pressed', async () => {
    const { box, cancel, onSave, onCancel } = renderEditor({ initial: 'Draft' })
    await box.fill('Changed my mind')
    await cancel.click()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves with Ctrl+Enter from the note box', async () => {
    const { box, onSave } = renderEditor()
    await box.fill('Keyboard note')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Keyboard note')
  })

  it('saves with Cmd+Enter from the note box', async () => {
    const { box, onSave } = renderEditor()
    await box.fill('Mac note')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Mac note')
  })

  it('adds a new line, and does not save, on a plain Enter', async () => {
    const { box, onSave } = renderEditor()
    await box.fill('First')
    await userEvent.keyboard('{Enter}Second')
    await expect.element(box).toHaveValue('First\nSecond')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('cancels with Escape from the note box', async () => {
    const { box, onCancel, onSave } = renderEditor({ initial: 'Draft' })
    await box.click()
    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('focuses the note box with the caret after the existing note when it opens with autoFocus', async () => {
    const { box } = renderEditor({ initial: 'Existing note', autoFocus: true })
    await expect.element(box).toHaveFocus()
    const element = box.element() as HTMLTextAreaElement
    expect(element.selectionStart).toBe('Existing note'.length)
    expect(element.selectionEnd).toBe('Existing note'.length)
  })

  it('does not take focus when it opens without autoFocus', async () => {
    const { box } = renderEditor({ initial: 'Existing note' })
    await expect.element(box).toBeVisible()
    await expect.element(box).not.toHaveFocus()
  })

  it('shows no character count below the count threshold', async () => {
    const { box } = renderEditor()
    await box.fill('x'.repeat(NOTE_COUNT_FROM - 1))
    await expect.element(page.getByText(`/ ${MAX_NOTE.toLocaleString('en-US')}`)).not.toBeInTheDocument()
  })

  it('shows the character count, tied to the note box, from the count threshold', async () => {
    const { box } = renderEditor()
    await box.fill('x'.repeat(NOTE_COUNT_FROM))
    const text = `${NOTE_COUNT_FROM.toLocaleString('en-US')} / ${MAX_NOTE.toLocaleString('en-US')}`
    await expect.element(page.getByText(text)).toBeVisible()
    await expect.element(box).toHaveAccessibleDescription(text)
  })

  it('allows saving a note of exactly the limit', async () => {
    const { box, save, onSave } = renderEditor()
    await box.fill('x'.repeat(MAX_NOTE))
    await expect.element(save).toBeEnabled()
    await save.click()
    expect(onSave).toHaveBeenCalledExactlyOnceWith('x'.repeat(MAX_NOTE))
  })

  it('disables Save once the note is over the limit', async () => {
    const { box, save } = renderEditor()
    await box.fill('x'.repeat(MAX_NOTE + 1))
    await expect.element(save).toBeDisabled()
  })

  it('does not save over the limit with Ctrl+Enter', async () => {
    const { box, onSave } = renderEditor()
    await box.fill('x'.repeat(MAX_NOTE + 1))
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('counts an emoji as one character toward the limit', async () => {
    const { box, save } = renderEditor()
    await box.fill('😀'.repeat(MAX_NOTE))
    await expect.element(save).toBeEnabled()
  })

  it('disables Save while a save is in flight', async () => {
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const { box, save, onSave } = renderEditor({ onSave: vi.fn(() => promise) })
    await box.fill('Slow save')
    await save.click()
    await expect.element(save).toBeDisabled()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(onSave).toHaveBeenCalledOnce()
    resolve(true)
    await expect.element(save).toBeEnabled()
  })

  it('returns focus to the note box when the save fails', async () => {
    const { box, save } = renderEditor({ onSave: vi.fn(async () => false) })
    await box.fill('Will not save')
    await save.click()
    await expect.element(box).toHaveFocus()
  })
})
