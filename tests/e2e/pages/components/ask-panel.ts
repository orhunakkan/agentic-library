import type { Locator, Page } from '@playwright/test'

export class AskPanel {
  readonly panel: Locator
  readonly openButton: Locator
  readonly questionBox: Locator

  constructor(readonly page: Page) {
    this.panel = page
      .getByRole('complementary', { name: 'Ask this book' })
      .or(page.getByRole('dialog', { name: 'Ask this book' }))
    this.openButton = page.getByRole('button', { name: /^Ask( this book)?$/ })
    this.questionBox = this.panel.getByRole('textbox', { name: 'Your question about this book' })
  }

  async open() {
    await this.openButton.click()
    await this.panel.waitFor()
    return this.panel
  }

  question(n: number) {
    return this.panel.getByRole('group', { name: new RegExp(`^${n}\\. `) })
  }

  card(front: string) {
    return this.panel.getByRole('listitem').filter({ has: this.page.getByText(front, { exact: true }) })
  }

  get promptsMenu() {
    return this.panel.getByRole('button', { name: 'Your prompts' })
  }

  async openPrompts() {
    await this.promptsMenu.click()
    const menu = this.page.getByRole('menu', { name: 'Your prompts' })
    await menu.waitFor()
    return menu
  }

  async runPrompt(name: string) {
    const menu = await this.openPrompts()
    await menu.getByRole('menuitem', { name, exact: true }).click()
  }

  get microphone() {
    return this.panel.getByRole('button', { name: /^(Ask by voice|Stop and send)$/ })
  }

  get voiceStatus() {
    return this.panel.getByTestId('ask-voice-status')
  }

  async openVoiceSettings() {
    await this.panel.getByRole('button', { name: 'Ask by voice settings' }).click()
    const popover = this.page.getByRole('dialog', { name: 'Ask by voice' })
    await popover.waitFor()
    return popover
  }

  listen(index: number) {
    return this.panel.locator(`[data-testid="ask-answer-listen"][data-key="${index}"]`)
  }

  async ask(question: string) {
    await this.questionBox.fill(question)
    await this.questionBox.press('Enter')
  }
}
