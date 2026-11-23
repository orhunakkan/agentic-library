import type { Locator, Page } from '@playwright/test'
import { isWide, press } from '../layout'

export class ContentsPanel {
  readonly panel: Locator
  readonly drawer: Locator
  readonly toolbarButton: Locator
  readonly hideButton: Locator
  readonly nav: Locator

  constructor(readonly page: Page) {
    this.panel = page.getByRole('complementary', { name: 'Book contents panel' })
    this.drawer = page.getByRole('dialog', { name: 'Contents' })
    this.toolbarButton = page.getByRole('button', { name: 'Contents', exact: true })
    this.hideButton = page.getByRole('button', { name: 'Hide contents panel' })
    this.nav = page.getByRole('navigation', { name: 'Contents' })
  }

  tab(name: string) {
    return this.page.getByRole('tab', { name: new RegExp(`^${name}`) })
  }

  tabPanel(name: string) {
    return this.page.getByRole('tabpanel', { name: new RegExp(`^${name}`) })
  }

  async openTab(name: string) {
    if (!isWide(this.page)) await press(this.page, this.toolbarButton)
    await press(this.page, this.tab(name))
    const panel = this.tabPanel(name)
    await panel.waitFor()
    return panel
  }
}
