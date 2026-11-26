import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { mountRoute } from '~/client/testing/router'
import { Route as CopyrightRoute } from '~/routes/copyright'
import { Route as CreditsRoute } from '~/routes/credits'
import { Route as PrivacyRoute } from '~/routes/privacy'
import { Route as TermsRoute } from '~/routes/terms'

/** The legal pages load the site contact from a server function; here it answers with a fixed address. */
vi.mock('~/server/functions', () => ({
  getSearchIndex: vi.fn(),
  getSiteContact: vi.fn(async () => ({ kind: 'email', value: 'notices@example.org' })),
}))

const SOURCE = 'https://github.com/example/folio'
/** Words left from the paid plan that no legal page may use again. */
const BILLING_WORDS = /\bPro\b|Paddle|price|subscription|refund/i

async function expectParts(ids: string[]) {
  const shown = [...document.querySelectorAll('main section h2')].map((heading) => heading.id)
  expect(shown).toEqual(ids)
}

async function expectContactAndNoBilling() {
  await expect.element(page.getByTestId('legal-contact').first()).toHaveAttribute('href', 'mailto:notices@example.org')
  expect(document.querySelector('main')?.textContent).not.toMatch(BILLING_WORDS)
}

describe('Terms', () => {
  it('has the twelve parts in order, the contact, and nothing about billing', async () => {
    await mountRoute(TermsRoute, '/terms', { sourceUrl: null })
    await expect.element(page.getByTestId('terms-title')).toBeVisible()
    await expectParts([
      'who',
      'free',
      'account',
      'content',
      'use',
      'copyright',
      'providers',
      'ending',
      'warranty',
      'liability',
      'changes',
      'contact',
    ])
    await expectContactAndNoBilling()
    await expect.element(page.getByTestId('terms-copyright-link').first()).toHaveAttribute('href', '/copyright')
  })

  it('links the code only when SOURCE_URL is set', async () => {
    await mountRoute(TermsRoute, '/terms', { sourceUrl: null })
    await expect.element(page.getByTestId('terms-title')).toBeVisible()
    await expect.element(page.getByTestId('legal-source-link')).not.toBeInTheDocument()
  })

  it('links the repository when SOURCE_URL is set', async () => {
    await mountRoute(TermsRoute, '/terms', { sourceUrl: SOURCE })
    await expect.element(page.getByTestId('legal-source-link')).toHaveAttribute('href', SOURCE)
  })
})

describe('Copyright', () => {
  it('has its eight parts, the six notice elements and the contact, and nothing about billing', async () => {
    await mountRoute(CopyrightRoute, '/copyright', { sourceUrl: SOURCE })
    await expect.element(page.getByTestId('copyright-title')).toBeVisible()
    await expectParts(['what', 'notice', 'next', 'mistake', 'repeat', 'false', 'other', 'code'])
    await expectContactAndNoBilling()
    const elements = [...document.querySelectorAll('[data-testid="copyright-notice-element"]')]
    expect(elements.map((element) => element.getAttribute('data-key'))).toEqual([
      'who',
      'work',
      'copy',
      'good-faith',
      'accurate',
      'signature',
    ])
    await expect.element(page.getByText('Folio closes an account after its third valid notice.')).toBeVisible()
    await expect.element(page.getByTestId('legal-source-link')).toHaveAttribute('href', SOURCE)
  })
})

describe('Privacy', () => {
  it('has its parts in order, the contact, and nothing about billing', async () => {
    await mountRoute(PrivacyRoute, '/privacy', { sourceUrl: null })
    await expect.element(page.getByTestId('privacy-title')).toBeVisible()
    await expectParts(['visiting', 'with-account', 'why', 'notices', 'who-else', 'rights', 'children', 'questions'])
    await expectContactAndNoBilling()
  })

  it('says searches and removals for notices are logged with the reason', async () => {
    await mountRoute(PrivacyRoute, '/privacy', { sourceUrl: null })
    await expect
      .element(page.getByText(/each removal with the reason, the book’s title and its owner’s username/))
      .toBeVisible()
  })
})

describe('Credits', () => {
  it('links the third-party licences and says Folio’s own code is MIT', async () => {
    await mountRoute(CreditsRoute, '/credits', { sourceUrl: null })
    const licences = page.getByTestId('credits-third-party-licences')
    await expect.element(licences).toHaveAttribute('href', '/third-party-licenses.txt')
    await expect.element(page.getByText(/Folio’s own code is open source under the MIT licence/)).toBeVisible()
  })
})
