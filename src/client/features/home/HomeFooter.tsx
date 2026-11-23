import { Link } from '@tanstack/react-router'
import { Logo } from '~/client/components/Logo'
import type { Viewer } from '~/server/auth'
import { SITE_CREDIT, SITE_NAME } from '~/shared/lib/site'

const link = 'font-medium text-accent hover:text-accent-strong hover:underline'

export function HomeFooter({ viewer }: { viewer: Viewer | null }) {
  return (
    <footer className="mt-20 border-t border-line-soft" style={{ paddingBottom: 'var(--player-h)' }}>
      <div className="page-wrap flex flex-col gap-6 py-10 text-[14px] text-muted md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2.5 text-ink">
            <Logo className="size-6" />
            <span className="font-display text-[17px] font-bold">{SITE_NAME}</span>
          </div>
          <p className="mt-3">© 2026 Orhun Akkan</p>
        </div>
        <p className="max-w-md">{SITE_CREDIT}</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li>
              <Link to="/library" className={link} data-testid="home-footer-link" data-key="library">
                The library
              </Link>
            </li>
            <li>
              <Link to="/privacy" className={link} data-testid="home-footer-link" data-key="privacy">
                Privacy
              </Link>
            </li>
            <li>
              <Link to="/terms" className={link} data-testid="home-footer-link" data-key="terms">
                Terms
              </Link>
            </li>
            <li>
              <Link to="/refunds" className={link} data-testid="home-footer-link" data-key="refunds">
                Refunds
              </Link>
            </li>
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
