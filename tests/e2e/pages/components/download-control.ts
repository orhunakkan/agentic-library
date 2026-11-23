import type { Locator, Page } from '@playwright/test'

export class DownloadControl {
  readonly button: Locator
  readonly progress: Locator
  readonly cancel: Locator
  readonly downloaded: Locator
  readonly remove: Locator

  constructor(readonly page: Page) {
    this.button = page.getByRole('button', { name: 'Download for offline' })
    this.progress = page.getByRole('progressbar', { name: /^Downloading / })
    this.cancel = page.getByRole('button', { name: 'Cancel' })
    this.downloaded = page.getByText(/^Downloaded · \d+(\.\d)? (KB|MB)$/)
    this.remove = page.getByRole('button', { name: 'Remove download' })
  }

  async download() {
    await this.button.click()
    await this.downloaded.waitFor()
  }

  keptPaths(): Promise<string[]> {
    return this.page.evaluate(async () => {
      if (!(await caches.has('folio-books-v1'))) return []
      const keys = await (await caches.open('folio-books-v1')).keys()
      return keys.map((r) => new URL(r.url).pathname).sort()
    })
  }

  cacheNames(): Promise<string[]> {
    return this.page.evaluate(async () => (await caches.keys()).sort())
  }

  copyField(slug: string, field: 'title' | 'version'): Promise<string | null> {
    return this.page.evaluate(
      async ({ slug, field }) => {
        if (!(await caches.has('folio-books-v1'))) return null
        const response = await (await caches.open('folio-books-v1')).match(`/offline/${slug}.json`)
        return response ? (((await response.json()) as Record<string, string>)[field] ?? null) : null
      },
      { slug, field },
    )
  }
}
