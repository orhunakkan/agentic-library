import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { mountAt } from '~/client/testing/router'
import { SITE_CREDIT } from '~/shared/lib/site'
import { HomeFooter } from './HomeFooter'

const SOURCE = 'https://github.com/example/folio'
/** The page's footer landmark, which every footer link sits in. */
const footer = page.getByRole('contentinfo')
const footerLink = (name: string) => footer.getByRole('link', { name, exact: true })

describe('HomeFooter', () => {
  it('says uploads stay private, and links Privacy, Terms, Copyright and Credits', async () => {
    await mountAt('/', <HomeFooter viewer={null} sourceUrl={null} />)
    /** The credit and the copyright line are plain text in the footer landmark, with no role or name to check. */
    await expect.element(footer.getByText(SITE_CREDIT)).toBeVisible()
    await expect.element(footer.getByText('© 2026 Orhun Akkan')).toBeVisible()
    await expect.element(footer.getByRole('navigation', { name: 'Footer' })).toBeVisible()
    for (const [name, path] of [
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
      ['Copyright', '/copyright'],
      ['Credits', '/credits'],
    ] as const)
      await expect.element(footerLink(name)).toHaveAttribute('href', path)
  })

  it('links the code when SOURCE_URL is set, as an external link', async () => {
    await mountAt('/', <HomeFooter viewer={null} sourceUrl={SOURCE} />)
    const source = page.getByRole('link', { name: 'Source code' })
    await expect.element(source).toHaveAttribute('href', SOURCE)
    await expect.element(source).toHaveAttribute('rel', 'noopener')
    await expect.element(source).toHaveAttribute('data-key', 'source')
  })

  it('shows no Source code link when SOURCE_URL is unset', async () => {
    await mountAt('/', <HomeFooter viewer={null} sourceUrl={null} />)
    await expect.element(footerLink('Credits')).toBeVisible()
    await expect.element(page.getByRole('link', { name: 'Source code' })).not.toBeInTheDocument()
  })
})
