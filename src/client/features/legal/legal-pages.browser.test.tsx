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

const main = page.getByRole('main')

/**
 * The page is one main landmark whose only top-level heading is the page's title. The title is found by its test id,
 * so its role and name are checked too.
 */
async function expectMainAndTitle(titleTestId: string, title: string) {
  await expect.element(main).toBeVisible()
  const heading = page.getByTestId(titleTestId)
  await expect.element(heading).toHaveRole('heading')
  await expect.element(heading).toHaveAccessibleName(title)
  await expect.element(main.getByRole('heading', { level: 1 })).toHaveAccessibleName(title)
}

/** Each part is a region named by its own heading, in order, so a screen reader can list and jump between them. */
async function expectParts(ids: string[]) {
  const headings = ids.map((id) => document.getElementById(id))
  expect(headings.map((heading) => heading?.tagName)).toEqual(ids.map(() => 'H2'))
  const regions = main.getByRole('region')
  expect(regions.elements().map((region) => region.getAttribute('aria-labelledby'))).toEqual(ids)
  for (const [i, heading] of headings.entries())
    await expect.element(regions.nth(i)).toHaveAccessibleName(heading?.textContent ?? '')
}

async function expectContactAndNoBilling() {
  const contact = page.getByTestId('legal-contact').first()
  await expect.element(contact).toHaveRole('link')
  await expect.element(contact).toHaveAccessibleName('notices@example.org')
  await expect.element(contact).toHaveAttribute('href', 'mailto:notices@example.org')
  expect(main.element().textContent).not.toMatch(BILLING_WORDS)
}

/** The link to Folio's code, found by its test id; its name is whatever words the page links. */
async function expectSourceLink(name: string) {
  const source = page.getByTestId('legal-source-link')
  await expect.element(source).toHaveRole('link')
  await expect.element(source).toHaveAccessibleName(name)
  await expect.element(source).toHaveAttribute('href', SOURCE)
}

describe('Terms', () => {
  it('has the twelve parts in order, the contact, and nothing about billing', async () => {
    await mountRoute(TermsRoute, '/terms', { sourceUrl: null })
    await expectMainAndTitle('terms-title', 'Terms')
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
    const copyright = page.getByTestId('terms-copyright-link').first()
    await expect.element(copyright).toHaveRole('link')
    await expect.element(copyright).toHaveAccessibleName('Copyright page')
    await expect.element(copyright).toHaveAttribute('href', '/copyright')
  })

  it('links the code only when SOURCE_URL is set', async () => {
    await mountRoute(TermsRoute, '/terms', { sourceUrl: null })
    await expectMainAndTitle('terms-title', 'Terms')
    await expect.element(page.getByTestId('legal-source-link')).not.toBeInTheDocument()
  })

  it('links the repository when SOURCE_URL is set', async () => {
    await mountRoute(TermsRoute, '/terms', { sourceUrl: SOURCE })
    await expectSourceLink('repository')
  })
})

describe('Copyright', () => {
  it('has its eight parts, the six notice elements and the contact, and nothing about billing', async () => {
    await mountRoute(CopyrightRoute, '/copyright', { sourceUrl: SOURCE })
    await expectMainAndTitle('copyright-title', 'Copyright')
    await expectParts(['what', 'notice', 'next', 'mistake', 'repeat', 'false', 'other', 'code'])
    await expectContactAndNoBilling()
    const elements = page.getByTestId('copyright-notice-element')
    /** Items of one list, so a screen reader says how many elements a notice needs. */
    for (const element of elements.all()) await expect.element(element).toHaveRole('listitem')
    expect(new Set(elements.elements().map((element) => element.parentElement))).toHaveLength(1)
    expect(elements.elements().map((element) => element.getAttribute('data-key'))).toEqual([
      'who',
      'work',
      'copy',
      'good-faith',
      'accurate',
      'signature',
    ])
    /** Plain text in a part, with no role or name of its own to check. */
    await expect.element(main.getByText('Folio closes an account after its third valid notice.')).toBeVisible()
    await expectSourceLink('source repository')
  })
})

describe('Privacy', () => {
  it('has its parts in order, the contact, and nothing about billing', async () => {
    await mountRoute(PrivacyRoute, '/privacy', { sourceUrl: null })
    await expectMainAndTitle('privacy-title', 'Privacy')
    await expectParts(['visiting', 'with-account', 'why', 'notices', 'who-else', 'rights', 'children', 'questions'])
    await expectContactAndNoBilling()
  })

  it('says searches and removals for notices are logged with the reason', async () => {
    await mountRoute(PrivacyRoute, '/privacy', { sourceUrl: null })
    /** Plain text in a part, with no role or name of its own to check. */
    await expect
      .element(main.getByText(/each removal with the reason, the book’s title and its owner’s username/))
      .toBeVisible()
  })
})

describe('Credits', () => {
  it('links the third-party licences and says Folio’s own code is MIT', async () => {
    await mountRoute(CreditsRoute, '/credits', { sourceUrl: null })
    await expectMainAndTitle('credits-title', 'Credits')
    const licences = page.getByTestId('credits-third-party-licences')
    await expect.element(licences).toHaveRole('link')
    await expect.element(licences).toHaveAccessibleName('third-party-licenses.txt')
    await expect.element(licences).toHaveAttribute('href', '/third-party-licenses.txt')
    /** Plain text in a part, with no role or name of its own to check. */
    await expect.element(main.getByText(/Folio’s own code is open source under the MIT licence/)).toBeVisible()
  })
})
