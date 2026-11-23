import type { Locator, Page } from '@playwright/test'

export const HOME_SECTION_LINKS_FROM = 760

export class HomePage {
  readonly heading: Locator
  readonly header: Locator
  readonly sections: Locator
  readonly footer: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 })
    this.header = page.getByRole('banner')
    this.sections = page.getByRole('navigation', { name: 'On this page' })
    this.footer = page.getByRole('contentinfo')
  }

  goto() {
    return this.page.goto('/')
  }

  get hasSectionLinks() {
    return (this.page.viewportSize()?.width ?? 0) >= HOME_SECTION_LINKS_FROM
  }

  section(name: string) {
    return this.page.getByRole('region', { name })
  }
}
