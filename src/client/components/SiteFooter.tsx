import { Link, useRouterState } from '@tanstack/react-router'
import { SITE_CREDIT, SITE_NAME } from '~/shared/lib/site'
import { Logo } from './Logo'

const footerLink = 'font-medium whitespace-nowrap text-accent hover:text-accent-strong hover:underline'

/** The footer on every page but the home page and the reader. `sourceUrl` is null when the code isn't linked. */
export function SiteFooter({ sourceUrl }: { sourceUrl: string | null }) {
  const inReader = useRouterState({ select: (s) => s.location.pathname.startsWith('/read/') })
  if (inReader) return null
  return (
    <footer
      data-chrome
      data-site-chrome
      className="mt-16 border-t border-line-soft"
      style={{ paddingBottom: 'var(--player-h)' }}
    >
      <div className="page-wrap flex flex-col gap-4 py-10 text-[14px] text-muted md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5 text-ink">
          <Logo className="size-6" />
          <span className="font-display text-[17px] font-bold">{SITE_NAME}</span>
        </div>
        <p className="max-w-xl">{SITE_CREDIT}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link to="/library" className={footerLink} data-testid="footer-link" data-key="library">
            Browse the library
          </Link>
          <Link to="/" className={footerLink} data-testid="footer-link" data-key="about">
            About {SITE_NAME}
          </Link>
          <Link to="/privacy" className={footerLink} data-testid="footer-link" data-key="privacy">
            Privacy
          </Link>
          <Link to="/terms" className={footerLink} data-testid="footer-link" data-key="terms">
            Terms
          </Link>
          <Link to="/copyright" className={footerLink} data-testid="footer-link" data-key="copyright">
            Copyright
          </Link>
          <Link to="/credits" className={footerLink} data-testid="footer-link" data-key="credits">
            Credits
          </Link>
          {sourceUrl && (
            <a href={sourceUrl} rel="noopener" className={footerLink} data-testid="footer-link" data-key="source">
              Source code
            </a>
          )}
        </div>
      </div>
    </footer>
  )
}
