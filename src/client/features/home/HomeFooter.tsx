import { Link } from '@tanstack/react-router'
import { Logo } from '~/client/components/Logo'
import type { Viewer } from '~/server/auth'
import { SITE_CREDIT, SITE_NAME } from '~/shared/lib/site'

const link = 'font-medium text-accent hover:text-accent-strong hover:underline'

const PAGES = [
  { to: '/library', key: 'library', label: 'The library' },
  { to: '/privacy', key: 'privacy', label: 'Privacy' },
  { to: '/terms', key: 'terms', label: 'Terms' },
  { to: '/copyright', key: 'copyright', label: 'Copyright' },
  { to: '/credits', key: 'credits', label: 'Credits' },
] as const

/** The home page's footer. `sourceUrl` is null when the code isn't linked. */
export function HomeFooter({ viewer, sourceUrl }: { viewer: Viewer | null; sourceUrl: string | null }) {
  return (
    <footer className="mt-20 border-t border-line-soft" style={{ paddingBottom: 'var(--player-h)' }}>
      <div className="page-wrap flex flex-col gap-6 py-10 text-[14px] text-muted md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2.5 text-ink">
            <Logo className="size-6" />
            <span className="font-display text-[17px] font-bold">{SITE_NAME}</span>
          </div>
          {/**
           * This © line is agenticlibrary.app's own. If you run Folio for other people, put your own name here, and
           * rewrite the Terms, Privacy and Copyright pages for your service.
           */}
          <p className="mt-3">© 2026 Orhun Akkan</p>
        </div>
        <p className="max-w-md">{SITE_CREDIT}</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {PAGES.map((page) => (
              <li key={page.key}>
                <Link to={page.to} className={link} data-testid="home-footer-link" data-key={page.key}>
                  {page.label}
                </Link>
              </li>
            ))}
            {sourceUrl && (
              <li>
                <a href={sourceUrl} rel="noopener" className={link} data-testid="home-footer-link" data-key="source">
                  Source code
                </a>
              </li>
            )}
            {!viewer && (
              <li>
                <Link
                  to="/login"
                  search={{ next: '/library' }}
                  className={link}
                  data-testid="home-footer-link"
                  data-key="sign-in"
                >
                  Sign in
                </Link>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </footer>
  )
}
