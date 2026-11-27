import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { HERO_LINE } from '~/client/features/home/Hero'
import { HomePage } from '~/client/features/home/HomePage'
import type { Viewer } from '~/server/auth'
import { mountAt } from '../../../../support/client/router'

const SIGNED_IN: Viewer = { username: 'reader', role: 'member' }

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
