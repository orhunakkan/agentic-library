import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { HERO_LINE } from '~/client/features/home/Hero'
import { HomePage } from '~/client/features/home/HomePage'
import type { Viewer } from '~/server/auth'
import { mountAt } from '../../../../support/client/router'

const SIGNED_IN: Viewer = { username: 'reader', role: 'member' }

const features = page.getByRole('region', { name: 'One app for reading, listening and remembering.' })
const featureRows = features.getByRole('article')
/** A row's label is the coloured line above its title, the row's first paragraph. */
const rowLabel = (row: Element) => row.querySelector('p')?.textContent
const featureRow = (label: string) => featureRows.filter({ has: page.getByText(label, { exact: true }) })

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
