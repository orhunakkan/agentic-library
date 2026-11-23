import { Link } from '@tanstack/react-router'
import type { Viewer } from '~/server/auth'
import { primaryButton } from './buttons'

export function ClosingCall({ viewer }: { viewer: Viewer | null }) {
  return (
    <section aria-labelledby="closing-title" className="mt-24 flex flex-col items-center text-center sm:mt-32">
      <h2
        id="closing-title"
        className="font-display text-[36px] leading-tight font-bold tracking-tight text-ink sm:text-[52px]"
      >
        Open a book. Press play.
      </h2>
      <p className="mt-4 text-[18px] text-body">Bring your own books, free.</p>
      <Link
        to={viewer ? '/account/books' : '/signup'}
        className={`${primaryButton()} mt-8`}
        data-testid="home-closing-start-reading"
      >
        Start reading free
      </Link>
      {!viewer && (
        <p className="mt-5 text-[15px] text-muted">
          Already have an account?{' '}
          <Link
            to="/login"
            search={{ next: '/library' }}
            data-testid="home-closing-sign-in"
            className="font-semibold text-accent hover:text-accent-strong hover:underline"
          >
            Sign in
          </Link>
        </p>
      )}
    </section>
  )
}
