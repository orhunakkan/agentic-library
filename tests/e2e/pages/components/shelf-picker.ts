import type { Locator, Page, Response } from '@playwright/test'

export class ShelfPicker {
  readonly button: Locator
  readonly popover: Locator

  constructor(readonly page: Page) {
    this.button = page.getByRole('button', { name: /^(Add to shelf|On )/ })
    this.popover = page.getByRole('dialog', { name: 'Add to shelf' })
  }

  async open() {
    await this.button.click()
    await this.popover.waitFor()
    await this.popover.getByText('Loading your shelves…').waitFor({ state: 'detached' })
    return this.popover
  }

  async tick(name: string, on = true): Promise<Response> {
    const answered = this.page.waitForResponse((r) => /\/account\/shelves\/[0-9a-f-]{36}\/books$/.test(r.url()))
    const box = this.popover.getByRole('checkbox', { name })
    await (on ? box.check() : box.uncheck())
    return answered
  }
}
