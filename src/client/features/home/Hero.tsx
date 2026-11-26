import { Link } from '@tanstack/react-router'
import type { Viewer } from '~/server/auth'
import { primaryButton, secondaryButton } from './buttons'

export const HERO_LINE =
  'Folio is a calm place to read on any screen. Have any page read aloud, keep your highlights in one place, and ask questions that only see the pages you’ve read.'

export function Hero({ viewer }: { viewer: Viewer | null }) {
  return (
    <section aria-labelledby="home-title" className="flex flex-col items-center pt-12 text-center sm:pt-16 lg:pt-20">
      <p className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13.5px] font-medium text-body">
        A reading app for every kind of book
      </p>
      <h1
        id="home-title"
        data-testid="home-title"
        className="mt-6 font-display text-[44px] leading-[1.04] font-bold tracking-tight text-balance text-ink min-[400px]:text-[52px] sm:text-[68px] lg:text-[80px]"
      >
        Read it. Hear it. <span className="block text-accent">Ask it.</span>
      </h1>
      <p className="mt-6 max-w-[620px] text-[17px] leading-relaxed text-body sm:text-[19px]">{HERO_LINE}</p>
      <div className="mt-8 flex w-full flex-col items-stretch gap-3 min-[400px]:w-auto min-[400px]:flex-row min-[400px]:items-center">
        <Link
          to={viewer ? '/account/books' : '/signup'}
          className={primaryButton()}
          data-testid="home-hero-start-reading"
        >
          Start reading free
        </Link>
        <a href="#features" className={secondaryButton()} data-testid="home-hero-see-features">
          See what it does
        </a>
      </div>
      <p className="mt-5 text-[14px] text-muted" data-testid="home-hero-free">
        Folio is free.
      </p>
    </section>
  )
}
