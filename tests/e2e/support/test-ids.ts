import type { Page } from '@playwright/test'

const COVERED = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'h1',
  '[aria-live]',
  ...[
    'button',
    'link',
    'tab',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'checkbox',
    'radio',
    'switch',
    'combobox',
    'searchbox',
    'slider',
    'option',
    'status',
    'alert',
  ].map((role) => `[role="${role}"]`),
].join(', ')

export function elementsWithoutTestId(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const describe = (el: Element) => {
      const role = el.getAttribute('role')
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)
      return `<${el.tagName.toLowerCase()}${role ? ` role=${role}` : ''}> "${name}"`
    }
    return [...document.querySelectorAll(selector)]
      .filter((el) => !el.hasAttribute('data-testid'))
      .filter((el) => !(el.tagName === 'INPUT' && el.getAttribute('aria-hidden') === 'true'))
      .map(describe)
  }, COVERED)
}
