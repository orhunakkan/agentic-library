import { expect, type Locator, type Page } from '@playwright/test'
import { press } from './layout'

export class RunDialog {
  readonly dialog: Locator
  readonly title: Locator
  readonly editor: Locator
  readonly runButton: Locator
  readonly stopButton: Locator
  readonly resetButton: Locator
  readonly closeButton: Locator
  readonly output: Locator
  readonly status: Locator
  readonly hint: Locator
  readonly note: Locator
  readonly proNotice: Locator
  readonly signedOut: Locator
  readonly readOnlyCode: Locator

  constructor(readonly page: Page) {
    this.dialog = page.getByRole('dialog', { name: /example$/ })
    this.title = this.dialog.getByRole('heading', { level: 2 })
    this.editor = this.dialog.getByRole('textbox', { name: 'Code' })
    this.runButton = this.dialog.getByRole('button', { name: /^Run\b/ })
    this.stopButton = this.dialog.getByRole('button', { name: 'Stop' })
    this.resetButton = this.dialog.getByRole('button', { name: 'Reset' })
    this.closeButton = this.dialog.getByRole('button', { name: 'Close' })
    this.output = this.dialog.getByRole('region', { name: 'Output' })
    this.status = this.dialog.getByRole('status')
    this.hint = this.dialog.getByTestId('run-hint')
    this.note = this.dialog.getByTestId('run-note')
    this.proNotice = this.dialog.getByTestId('run-pro')
    this.signedOut = this.dialog.getByTestId('run-signed-out')
    this.readOnlyCode = this.dialog.getByTestId('run-code')
  }

  openButtons(language: string) {
    return this.page.getByRole('button', { name: `Run ${language} example`, exact: true })
  }

  async openFrom(button: Locator) {
    await button.scrollIntoViewIfNeeded()
    await press(this.page, button)
    await expect(this.dialog).toBeVisible()
  }

  async write(code: string) {
    await this.editor.fill(code)
  }

  async run({ keys = false } = {}) {
    if (keys) await this.editor.press('Control+Enter')
    else await press(this.page, this.runButton)
  }

  async close() {
    await press(this.page, this.closeButton)
    await expect(this.dialog).toBeHidden()
  }
}
