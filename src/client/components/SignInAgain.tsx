import { Link, useRouterState } from '@tanstack/react-router'

/** A “Sign in” link that comes back to this page, after a sentence saying the reader was signed out. */
export function SignInAgain({ testId }: { testId: string }) {
  const here = useRouterState({ select: (s) => s.location.href })
  return (
    <>
      {' '}
      <Link
        to="/login"
        search={{ next: here }}
        className="font-semibold underline underline-offset-4"
        data-testid={testId}
      >
        Sign in
      </Link>
    </>
  )
}
