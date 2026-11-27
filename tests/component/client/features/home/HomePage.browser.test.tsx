import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { HERO_LINE } from '~/client/features/home/Hero'
import { HomePage } from '~/client/features/home/HomePage'
import type { Viewer } from '~/server/auth'
import { mountAt } from '../../../../support/client/router'

const SOURCE = 'https://github.com/example/folio'
const SIGNED_IN: Viewer = { username: 'reader', role: 'member' }

const features = page.getByRole('region', { name: 'One app for reading, listening and remembering.' })
const featureRows = features.getByRole('article')
/** A row's label is the coloured line above its title, the row's first paragraph. */
const rowLabel = (row: Element) => row.querySelector('p')?.textContent
const featureRow = (label: string) => featureRows.filter({ has: page.getByText(label, { exact: true }) })

const more = page.getByRole('region', { name: 'And everything around the reading.' })
const tile = (title: string) => more.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) })

const faq = page.getByRole('region', { name: 'Questions' })
/** Opens a FAQ answer, which sits closed in its `<details>` until the question is clicked. */
async function openQuestion(question: string) {
  await faq.getByText(question, { exact: true }).click()
}

const mountHome = (viewer: Viewer | null, sourceUrl: string | null = null) =>
  mountAt('/', <HomePage viewer={viewer} sourceUrl={sourceUrl} />, { viewer })

describe.each([
  ['signed out', null],
  ['signed in', SIGNED_IN],
] as const)('HomePage, %s', (_, viewer) => {
  it('names AI in the hero’s pill, and keeps one h1', async () => {
    await mountHome(viewer)
    await expect.element(page.getByText('A reading app with AI that won’t spoil the ending')).toBeVisible()
    await expect.element(page.getByText(HERO_LINE)).toBeVisible()
    expect(page.getByRole('heading', { level: 1 }).elements()).toHaveLength(1)
  })

  it('shows the five feature rows in order, with Ask the AI first', async () => {
    await mountHome(viewer)
    await expect.element(featureRows.first()).toBeVisible()
    expect(featureRows.elements().map(rowLabel)).toEqual([
      'Ask the AI',
      'Listen',
      'Remember',
      'Your own books',
      'Read your way',
    ])
    expect(features.getByRole('heading', { level: 3 }).elements()).toHaveLength(5)
  })

  it('says where the AI helps in the Listen and Remember rows', async () => {
    await mountHome(viewer)
    await expect.element(featureRow('Listen')).toMatchTextContent(/ask .* out loud/i)
    await expect.element(featureRow('Remember')).toMatchTextContent('Ask makes the cards')
  })

  it('names PDF and audiobooks among your own books', async () => {
    await mountHome(viewer)
    await expect.element(featureRow('Your own books')).toMatchTextContent('PDF')
    await expect.element(featureRow('Your own books')).toMatchTextContent('M4B')
  })

  it('doesn’t suggest reading settings work without an account', async () => {
    await mountHome(viewer)
    await expect
      .element(featureRow('Read your way'))
      .toMatchTextContent('your theme, font, spacing and width follow you to every device')
    await expect.element(featureRow('Read your way')).not.toMatchTextContent('with an account')
  })

  it('shows the nine smaller features in order, after the rows', async () => {
    await mountHome(viewer)
    await expect.element(more).toBeVisible()
    expect(
      more
        .getByRole('heading', { level: 3 })
        .elements()
        .map((h) => h.textContent),
    ).toEqual([
      'Look up any word',
      'Run the code in a book',
      'Read GitHub repositories',
      'Reading goals and streaks',
      'Shelves and ratings',
      'Read offline',
      'Install it as an app',
      'Pick up on any device',
      'Sign in with a passkey',
    ])
    const sections = page.getByRole('main').getByRole('heading', { level: 2 }).elements()
    expect(sections.map((h) => h.textContent)).toContain('And everything around the reading.')
    expect(features.element().compareDocumentPosition(more.element())).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('says they come with an account', async () => {
    await mountHome(viewer)
    await expect.element(more.getByText('With your account.', { exact: true })).toBeVisible()
    await expect.element(tile('Install it as an app')).not.toMatchTextContent('No account needed')
  })

  it('says reading needs an account, since Folio doesn’t come with books, and what else it adds', async () => {
    await mountHome(viewer)
    await openQuestion('Do I need an account to read?')
    const answer = faq.getByText(/^Yes\. Folio doesn’t come with books: you bring your own/)
    for (const feature of ['Ask the AI', 'audiobooks', 'flashcards', 'offline reading', 'passkeys'])
      await expect.element(answer).toMatchTextContent(feature)
  })

  it('answers whether Folio works offline', async () => {
    await mountHome(viewer)
    await openQuestion('Does Folio work offline?')
    await expect.element(faq.getByText(/Downloads are removed when you sign out\./)).toBeVisible()
  })

  it('links the source code from the open-source question', async () => {
    await mountHome(viewer, SOURCE)
    await openQuestion('Is Folio open source?')
    await expect.element(faq.getByRole('link', { name: 'source code' })).toHaveAttribute('href', SOURCE)
  })

  it('still answers the open-source question with no link when SOURCE_URL is unset', async () => {
    await mountHome(viewer, null)
    await openQuestion('Is Folio open source?')
    await expect.element(faq.getByText(/MIT licence/)).toBeVisible()
    expect(faq.getByRole('link').elements()).toHaveLength(0)
  })

  it('doesn’t mention Storybook', async () => {
    await mountHome(viewer)
    await expect.element(page.getByRole('main')).toBeVisible()
    expect(document.body.textContent).not.toMatch(/storybook/i)
  })
})

describe('HERO_LINE', () => {
  it('tells a visitor that Folio has an AI that answers from the book', () => {
    expect(HERO_LINE).toContain('Ask the AI about what you’re reading')
  })
})
