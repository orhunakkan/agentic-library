import type { Locator, Page } from '@playwright/test'
import { press } from '../layout'

export class AudioPlayer {
  readonly dock: Locator
  readonly sheet: Locator
  readonly openButton: Locator
  readonly closeButton: Locator

  constructor(readonly page: Page) {
    this.dock = page.getByRole('region', { name: 'Audio player' })
    this.sheet = page.getByRole('dialog', { name: 'Now playing' })
    this.openButton = page.getByRole('button', { name: /Open player/ })
    this.closeButton = page.getByRole('button', { name: 'Close player' })
  }

  playEpisode(title: string) {
    return this.page.getByRole('button', { name: `Play ${title}` })
  }

  dockButton(name: string) {
    return this.dock.getByRole('button', { name, exact: true })
  }

  sheetButton(name: string) {
    return this.sheet.getByRole('button', { name, exact: true })
  }

  async openSheet() {
    await press(this.page, this.dock.getByRole('button', { name: /Open player/ }))
    await this.sheet.waitFor()
  }
}
