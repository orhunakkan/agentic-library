import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { mount } from '~/client/testing/mount'
import { RunDialog, type RunTarget, useRunEdits } from './RunDialog'
import { OUTPUT_EMPTY, titleText } from './run-messages'
import type { useRunner } from './use-runner'

/** The sandbox is stubbed where the dialog meets it, so no iframe, engine or Pyodide ever loads. */
type Runner = ReturnType<typeof useRunner>

const runner = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('./use-runner', () => ({ useRunner: () => runner.current }))

function stubRunner(state: Partial<Runner> = {}): Runner {
  const stub: Runner = {
    status: 'idle',
    output: { shown: [], count: 0, chars: 0, capped: false },
    error: null,
    hint: null,
    ms: 0,
    busy: false,
    run: vi.fn(async () => {}),
    stop: vi.fn(),
    ...state,
  }
  runner.current = stub
  return stub
}

const CODE = 'console.log("hello")'

function Harness({ onClose }: { onClose: () => void }) {
  const [target, setTarget] = useState<RunTarget | null>(null)
  const edits = useRunEdits('book')
  return (
    <>
      <button
        type="button"
        onClick={(e) => setTarget({ lang: 'javascript', code: CODE, key: 'block-1', opener: e.currentTarget })}
      >
        Run this example
      </button>
      <button type="button">Outside the dialog</button>
      <RunDialog
        target={target}
        access="pro"
        edits={edits}
        onClose={() => {
          onClose()
          setTarget(null)
        }}
      />
    </>
  )
}

const opener = page.getByRole('button', { name: 'Run this example' })
const dialog = page.getByRole('dialog', { name: titleText('javascript') })
const editor = dialog.getByRole('textbox', { name: 'Code' })
const output = dialog.getByRole('region', { name: 'Output' })

async function openDialog() {
  const onClose = vi.fn()
  mount(<Harness onClose={onClose} />)
  await opener.click()
  await expect.element(dialog).toBeVisible()
  return onClose
}

beforeEach(() => {
  stubRunner()
})

describe('RunDialog', () => {
  it('shows no dialog until there is code to run', async () => {
    mount(<Harness onClose={vi.fn()} />)
    await expect.element(opener).toBeVisible()
    await expect.element(dialog).not.toBeInTheDocument()
  })

  it('opens as a modal dialog titled with the language', async () => {
    await openDialog()
    expect(dialog.element().matches(':modal')).toBe(true)
  })

  it('focuses the code editor when it opens', async () => {
    await openDialog()
    await expect.element(editor).toHaveFocus()
    await expect.element(editor).toHaveValue(CODE)
  })

  it('closes with the Close button and returns focus to the button that opened it', async () => {
    const onClose = await openDialog()
    await dialog.getByRole('button', { name: 'Close' }).click()
    expect(onClose).toHaveBeenCalledOnce()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(opener).toHaveFocus()
  })

  it('closes with Escape and returns focus to the button that opened it', async () => {
    const onClose = await openDialog()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(opener).toHaveFocus()
  })

  it('returns focus to the button that opened it even when that button never took focus, as in Safari', async () => {
    mount(<Harness onClose={vi.fn()} />)
    /** A click event without the focus a real click gives, so the browser's own dialog focus restore has nothing to return to. */
    opener.element().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await expect.element(dialog).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(opener).toHaveFocus()
  })

  it('keeps Tab and Shift+Tab focus inside the dialog', async () => {
    await openDialog()
    const outside = page.getByRole('button', { name: 'Outside the dialog' }).element()
    for (const key of [
      '{Tab}',
      '{Tab}',
      '{Tab}',
      '{Tab}',
      '{Tab}',
      '{Tab}',
      '{Shift>}{Tab}{/Shift}',
      '{Shift>}{Tab}{/Shift}',
    ]) {
      await userEvent.keyboard(key)
      expect(document.activeElement).not.toBe(outside)
      expect(document.activeElement === document.body || dialog.element().contains(document.activeElement)).toBe(true)
    }
  })

  it('makes the page behind it unreachable while it is open', async () => {
    await openDialog()
    const outside = page.getByRole('button', { name: 'Outside the dialog' }).element() as HTMLButtonElement
    outside.focus()
    expect(document.activeElement).not.toBe(outside)
  })

  it('says where output will appear before anything has run', async () => {
    await openDialog()
    await expect.element(output).toHaveTextContent(OUTPUT_EMPTY)
    await expect.element(dialog.getByRole('status')).toHaveTextContent('Press Run, or Ctrl+Enter.')
  })

  it('shows each line of output in the output region', async () => {
    stubRunner({
      status: 'done',
      ms: 12,
      output: {
        shown: [
          { t: 'line', level: 'log', text: 'hello', indent: 0 },
          { t: 'line', level: 'error', text: 'boom', indent: 0 },
        ],
        count: 2,
        chars: 9,
        capped: false,
      },
    })
    await openDialog()
    await expect.element(output.getByText('hello')).toBeVisible()
    await expect.element(output.getByText('Error: boom')).toBeVisible()
    await expect.element(output.getByText(OUTPUT_EMPTY)).not.toBeInTheDocument()
    await expect.element(dialog.getByRole('status')).toHaveTextContent('Finished in 12 ms.')
  })

  it('runs the code in the editor when Run is pressed', async () => {
    const stub = stubRunner()
    await openDialog()
    await editor.fill('console.log(2)')
    await dialog.getByRole('button', { name: /Run/ }).click()
    expect(stub.run).toHaveBeenCalledExactlyOnceWith('console.log(2)')
  })

  it('runs the code with Ctrl+Enter from the editor', async () => {
    const stub = stubRunner()
    await openDialog()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(stub.run).toHaveBeenCalledExactlyOnceWith(CODE)
  })

  it('does not start a second run with Ctrl+Enter while one is running', async () => {
    const stub = stubRunner({ status: 'running', busy: true })
    await openDialog()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(stub.run).not.toHaveBeenCalled()
  })

  it('offers Stop in place of Run while code is running', async () => {
    const stub = stubRunner({ status: 'running', busy: true })
    await openDialog()
    await expect.element(dialog.getByRole('button', { name: /Run/ })).not.toBeInTheDocument()
    await dialog.getByRole('button', { name: 'Stop' }).click()
    expect(stub.stop).toHaveBeenCalledOnce()
  })

  it('disables Reset until the code is changed, and puts the original back', async () => {
    await openDialog()
    const reset = dialog.getByRole('button', { name: 'Reset' })
    await expect.element(reset).toBeDisabled()
    await editor.fill('changed')
    await expect.element(reset).toBeEnabled()
    await reset.click()
    await expect.element(editor).toHaveValue(CODE)
    await expect.element(editor).toHaveFocus()
    await expect.element(reset).toBeDisabled()
  })

  it('keeps an edit when the same example is opened again', async () => {
    await openDialog()
    await editor.fill('edited')
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await opener.click()
    await expect.element(editor).toHaveValue('edited')
  })
})
