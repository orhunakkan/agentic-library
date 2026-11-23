import type { Locator, Page } from '@playwright/test'
import { isWide, NAV_WIDE } from './layout'

const REPO_CHANGE = /\/account\/repos\/[0-9a-f-]{36}$/

export class ReposPage {
  readonly title: Locator
  readonly address: Locator
  readonly addButton: Locator
  readonly addError: Locator
  readonly empty: Locator
  readonly count: Locator
  readonly cards: Locator

  constructor(readonly page: Page) {
    this.title = page.getByRole('heading', { level: 1, name: 'Repositories' })
    this.address = page.getByLabel('Repository address')
    this.addButton = page.getByRole('button', { name: 'Add', exact: true })
    this.addError = page.getByTestId('repos-add-error')
    this.empty = page.getByText('You haven’t added a repository yet.')
    this.count = page.getByTestId('repos-count')
    this.cards = page.getByTestId('repo-card')
  }

  goto() {
    return this.page.goto('/account/repos')
  }

  async add(url: string, { sent = true } = {}) {
    await this.address.fill(url)
    const answered = sent ? this.page.waitForResponse((r) => r.url().endsWith('/account/repos/new')) : null
    await this.addButton.click()
    await answered
  }

  card(fullName: string) {
    return this.cards.filter({ has: this.page.getByRole('heading', { name: fullName }) })
  }

  open(fullName: string) {
    return this.card(fullName).getByRole('link', { name: fullName }).click()
  }

  async remove(fullName: string) {
    await this.card(fullName).getByRole('button', { name: 'Remove' }).click()
    const dialog = this.page.getByRole('dialog', { name: 'Remove repository' })
    const answered = this.page.waitForResponse((r) => REPO_CHANGE.test(r.url()))
    await dialog.getByRole('button', { name: 'Remove' }).click()
    await answered
  }

  get viewerTitle() {
    return this.page.getByTestId('repo-title')
  }

  get readme() {
    return this.page.getByTestId('repo-readme')
  }

  get file() {
    return this.page.getByTestId('repo-file')
  }

  get fileInfo() {
    return this.page.getByTestId('repo-file-info')
  }

  get refreshed() {
    return this.page.getByTestId('repo-refreshed')
  }

  async tree(): Promise<Locator> {
    if (isWide(this.page, NAV_WIDE))
      return this.page.getByRole('complementary').getByRole('navigation', { name: 'Files' })
    await this.page.getByTestId('repo-files-toggle').click()
    const tree = this.page.getByRole('dialog', { name: 'Files' }).getByRole('navigation', { name: 'Files' })
    await tree.waitFor()
    return tree
  }

  async openFromTree(path: string) {
    const tree = await this.tree()
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const folder = tree.locator(`[data-testid="repo-tree-folder"][data-key="${parts.slice(0, i).join('/')}"]`)
      if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.click()
    }
    await tree.locator(`[data-testid="repo-tree-file"][data-key="${path}"]`).click()
    await this.page.waitForURL((url) => url.searchParams.get('path') === path)
  }

  async refresh() {
    const answered = this.page.waitForResponse((r) => REPO_CHANGE.test(r.url()))
    await this.page.getByRole('button', { name: 'Refresh' }).click()
    await answered
  }
}
