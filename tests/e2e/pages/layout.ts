import type { Locator, Page } from '@playwright/test'

export const READER_WIDE = 900

export const NAV_WIDE = 1024

export const isWide = (page: Page, from = READER_WIDE) => (page.viewportSize()?.width ?? 0) >= from

export const press = (page: Page, target: Locator) => (isWide(page) ? target.click() : target.tap())
