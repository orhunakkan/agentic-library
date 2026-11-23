import type { Page } from '@playwright/test'

export async function hydrated(page: Page) {
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' })
}

export async function settled(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== 'running' ||
          a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY ||
          !(a.effect as KeyframeEffect | null)?.getKeyframes().some((k) => 'opacity' in k || 'transform' in k),
      ),
  )
}
