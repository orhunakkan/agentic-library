import type { Locator, Page } from '@playwright/test'
import { press } from '../layout'

export class ReadAloud {
  readonly startButton: Locator
  readonly dock: Locator
  readonly openButton: Locator
  readonly sheet: Locator
  readonly offer: Locator
  readonly offerDownload: Locator
  readonly voiceMenu: Locator
  readonly speechElement: Locator

  constructor(readonly page: Page) {
    this.startButton = page.getByRole('button', { name: 'Read aloud', exact: true })
    this.dock = page.getByRole('region', { name: 'Read aloud' })
    this.openButton = this.dock.getByRole('button', { name: /Open player/ })
    this.sheet = page.getByRole('dialog', { name: 'Now playing' })
    this.offer = this.sheet.getByRole('region', { name: 'Try the Folio voice' })
    this.offerDownload = this.sheet.getByRole('region', { name: 'Folio voice' })
    this.voiceMenu = page.getByRole('menu', { name: 'Voice' })
    this.speechElement = page.getByTestId('speech-element')
  }

  dockButton(name: string) {
    return this.dock.getByRole('button', { name, exact: true })
  }

  sheetButton(name: string) {
    return this.sheet.getByRole('button', { name, exact: true })
  }

  async start() {
    await press(this.page, this.startButton)
    await this.dock.waitFor()
  }

  async openVoiceMenu() {
    if (!(await this.sheet.isVisible())) await this.openSheet()
    await press(this.page, this.sheet.getByRole('button', { name: /^Voice/ }))
    await this.voiceMenu.waitFor()
    return this.voiceMenu
  }

  speechPlaying() {
    return this.speechElement.evaluate((a: HTMLAudioElement) => !a.paused && a.src.startsWith('blob:'))
  }

  async openSheet() {
    await press(this.page, this.openButton)
    await this.sheet.waitFor()
  }
}
