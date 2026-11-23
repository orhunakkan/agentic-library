import type { Locator, Page } from '@playwright/test'
import { isWide, NAV_WIDE } from '../layout'

export class SiteNav {
  readonly sidebar: Locator
  readonly menuButton: Locator
  readonly drawer: Locator

  constructor(readonly page: Page) {
    this.sidebar = page.getByRole('complementary', { name: 'Site navigation' })
    this.menuButton = page.getByRole('button', { name: 'Open menu' })
    this.drawer = page.getByRole('dialog', { name: 'Menu' })
  }

  get hasSidebar() {
    return isWide(this.page, NAV_WIDE)
  }

  async open(how: 'click' | 'tap' = 'click'): Promise<Locator> {
    if (this.hasSidebar) return this.sidebar
    await (how === 'tap' ? this.menuButton.tap() : this.menuButton.click())
    await this.drawer.getByRole('navigation', { name: 'Main' }).waitFor()
    return this.drawer
  }
}
