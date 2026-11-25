import { Link } from '@tanstack/react-router'
import { Logo } from '~/client/components/Logo'
import { ThemeToggle } from '~/client/components/ThemeToggle'
import type { Viewer } from '~/server/auth'
import { SITE_NAME } from '~/shared/lib/site'
import { primaryButton } from './buttons'

const SECTIONS = [
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'Questions' },
] as const

const iconButton =
  'grid size-10 shrink-0 place-items-center rounded-full text-body transition hover:bg-panel hover:text-ink sm:size-11'

export function HomeHeader({ viewer }: { viewer: Viewer | null }) {
  return (
    <header className="sticky top-0 z-50 h-16 border-b border-line-soft bg-page/90 backdrop-blur-xl">
      <div className="page-wrap flex h-full items-center gap-1.5 sm:gap-2">
        <a
          href="#top"
          data-testid="home-header-brand"
          aria-label={`${SITE_NAME}, back to the top`}
          className="flex shrink-0 items-center gap-2.5 rounded-full py-1 pr-2 text-ink"
        >
          <Logo />
          <span className="hidden font-display text-[19px] font-bold min-[400px]:inline">{SITE_NAME}</span>
        </a>
        <nav aria-label="On this page" className="mx-auto hidden min-[760px]:block">
          <ul className="flex items-center gap-1">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <a
                  href={section.href}
                  data-testid="home-header-section"
                  data-key={section.href.slice(1)}
                  className="rounded-full px-3.5 py-2 text-[15px] font-medium text-body transition hover:bg-panel hover:text-ink"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-1.5 min-[760px]:ml-0">
          <ThemeToggle className={iconButton} />
          {viewer ? (
            <Link to="/library" className={primaryButton('compact')} data-testid="home-header-open-library">
              Open the library
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                search={{ next: '/library' }}
                data-testid="home-header-sign-in"
                className="flex h-10 shrink-0 items-center rounded-full px-2.5 text-[14px] font-semibold whitespace-nowrap text-body transition hover:bg-panel hover:text-ink sm:h-11 sm:px-3.5 sm:text-[15px]"
              >
                Sign in
              </Link>
              <Link to="/signup" className={primaryButton('compact')} data-testid="home-header-start-reading">
                Start reading free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
