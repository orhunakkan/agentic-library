import type { Locator, Page } from '@playwright/test'

const PROMPT_CHANGE = /\/account\/prompts\/[0-9a-f-]{36}$/

export class PromptsPage {
  readonly title: Locator
  readonly count: Locator
  readonly empty: Locator
  readonly starters: Locator
  readonly cards: Locator
  readonly name: Locator
  readonly instruction: Locator
  readonly error: Locator
  readonly status: Locator

  constructor(readonly page: Page) {
    this.title = page.getByRole('heading', { level: 1, name: 'Your prompts' })
    this.count = page.getByTestId('prompts-count')
    this.empty = page.getByTestId('prompts-empty')
    this.starters = page.getByTestId('prompt-starter')
    this.cards = page.getByTestId('prompt-card')
    this.name = page.getByLabel('Name', { exact: true })
    this.instruction = page.getByLabel('What it asks')
    this.error = page.getByTestId('prompt-error')
    this.status = page.getByTestId('prompts-status')
  }

  goto() {
    return this.page.goto('/account/prompts')
  }

  card(name: string) {
    return this.cards.filter({ has: this.page.getByRole('heading', { name, exact: true }) })
  }

  useStarter(name: string) {
    return this.page.getByRole('button', { name: `Use “${name}”` }).click()
  }

  async fill({ name, on, instruction }: { name?: string; on?: 'pages' | 'passage'; instruction?: string }) {
    if (name !== undefined) await this.name.fill(name)
    if (on) await this.page.getByLabel(on === 'pages' ? /^The pages I’ve read/ : /^A passage I select/).check()
    if (instruction !== undefined) await this.instruction.fill(instruction)
  }

  async save() {
    const answered = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/account\/prompts\/(new|[0-9a-f-]{36})$/.test(r.url()),
    )
    await this.page.getByRole('button', { name: 'Save', exact: true }).click()
    await answered
  }

  edit(name: string) {
    return this.card(name).getByRole('button', { name: 'Edit' }).click()
  }

  async move(name: string, direction: 'up' | 'down') {
    const answered = this.page.waitForResponse((r) => PROMPT_CHANGE.test(r.url()))
    await this.page.getByRole('button', { name: `Move “${name}” ${direction}` }).click()
    await answered
  }

  async delete(name: string) {
    await this.card(name).getByRole('button', { name: 'Delete' }).click()
    const dialog = this.page.getByRole('dialog', { name: 'Delete prompt' })
    const answered = this.page.waitForResponse((r) => PROMPT_CHANGE.test(r.url()))
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await answered
  }

  names() {
    return this.cards.getByRole('heading').allTextContents()
  }
}
