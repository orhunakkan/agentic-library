import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { mountAt } from '~/client/testing/router'
import { SITE_CREDIT } from '~/shared/lib/site'
import { SiteFooter } from './SiteFooter'

/** The command palette's search index is a server function; nothing here searches, so it is never called. */
vi.mock('~/server/functions', () => ({ getSearchIndex: vi.fn() }))

const SOURCE = 'https://github.com/example/folio'
const footerLink = (name: string) => page.getByRole('link', { name, exact: true })

describe('SiteFooter', () => {
  it('says uploads stay private, and links Privacy, Terms, Copyright and Credits', async () => {
    await mountAt('/library', <SiteFooter sourceUrl={null} />)
    await expect.element(page.getByText(SITE_CREDIT)).toBeVisible()
    expect(SITE_CREDIT).not.toMatch(/public domain/)
    for (const [name, path] of [
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
      ['Copyright', '/copyright'],
      ['Credits', '/credits'],
    ] as const)
      await expect.element(footerLink(name)).toHaveAttribute('href', path)
  })

  it('links the code when SOURCE_URL is set, as an external link', async () => {
    await mountAt('/library', <SiteFooter sourceUrl={SOURCE} />)
    const source = page.getByRole('link', { name: 'Source code' })
    await expect.element(source).toHaveAttribute('href', SOURCE)
    await expect.element(source).toHaveAttribute('rel', 'noopener')
    await expect.element(source).toHaveAttribute('data-key', 'source')
  })

  it('shows no Source code link when SOURCE_URL is unset', async () => {
    await mountAt('/library', <SiteFooter sourceUrl={null} />)
    await expect.element(footerLink('Credits')).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Source code' })).not.toBeInTheDocument()
  })
})
