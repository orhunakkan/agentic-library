import { Link } from '@tanstack/react-router'

export function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center"
      style={{ paddingBottom: 'var(--player-h)' }}
    >
      <p className="eyebrow text-accent">404</p>
      <h1
        className="mt-3 font-display text-[clamp(34px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.03em] text-balance text-ink"
        data-testid="not-found-title"
      >
        This page isn’t on our shelves
      </h1>
      <p className="mt-3 text-muted">The link may be old, or the page number may be outside the book.</p>
      <Link
        to="/library"
        data-testid="not-found-library"
        className="mt-8 inline-flex h-12 items-center rounded-xl bg-accent-fill px-6 text-[15px] font-semibold text-on-accent transition hover:brightness-105"
      >
        Back to the library
      </Link>
    </main>
  )
}
