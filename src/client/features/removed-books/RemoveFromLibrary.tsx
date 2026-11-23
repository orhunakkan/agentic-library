import { Link, useRouteContext, useRouter, useRouterState } from '@tanstack/react-router'
import { EyeOff, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { forgetSearchIndex } from '~/client/components/CommandPalette'
import { problemText, type RemovedBookProblem, setRemoved } from './removed-books-client'

export function useBookRemoval() {
  const router = useRouter()
  return async (slug: string, removed: boolean): Promise<RemovedBookProblem | null> => {
    const result = await setRemoved(slug, removed)
    if (!result.ok) return result.problem
    forgetSearchIndex()
    await router.invalidate()
    return null
  }
}

export function RemovalProblem({ problem }: { problem: RemovedBookProblem }) {
  const here = useRouterState({ select: (s) => s.location.href })
  return (
    <>
      {problemText(problem)}
      {problem === 'signed_out' && (
        <>
          {' '}
          <Link
            to="/login"
            search={{ next: here }}
            className="font-semibold underline underline-offset-4"
            data-testid="removal-sign-in"
          >
            Sign in
          </Link>
        </>
      )}
    </>
  )
}

export function RemoveFromLibrary({ slug, removed }: { slug: string; removed: boolean }) {
  const { viewer } = useRouteContext({ from: '__root__' })
  return viewer ? <RemoveButton slug={slug} removed={removed} /> : null
}

function RemoveButton({ slug, removed: saved }: { slug: string; removed: boolean }) {
  const change = useBookRemoval()
  const [removed, setRemovedState] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(false)
  const [problem, setProblem] = useState<RemovedBookProblem | null>(null)

  useEffect(() => setRemovedState(saved), [saved])

  async function toggle() {
    const next = !removed
    setProblem(null)
    setBusy(true)
    setRemovedState(next)
    const found = await change(slug, next)
    setBusy(false)
    if (found) {
      setRemovedState(!next)
      setProblem(found)
      return
    }
    setChanged(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        data-testid="book-remove-from-library"
        disabled={busy}
        className="inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-[15px] font-semibold text-ink transition hover:-translate-y-0.5 hover:bg-panel active:scale-[.98] disabled:opacity-60"
      >
        {removed ? <Undo2 className="size-[18px]" aria-hidden /> : <EyeOff className="size-[18px]" aria-hidden />}
        {removed ? 'Restore to library' : 'Remove from library'}
      </button>
      <p role="status" data-testid="book-removal-status" className="basis-full text-[14px] text-muted empty:hidden">
        {!busy &&
          removed &&
          'Removed from your library. It no longer shows in your library, its series or search; others still see it.'}
        {!busy && !removed && changed && 'Back in your library.'}
      </p>
      {problem && (
        <p
          role="alert"
          data-testid="book-removal-error"
          className="basis-full text-[14px] text-red-700 dark:text-red-300"
        >
          <RemovalProblem problem={problem} />
        </p>
      )}
    </>
  )
}
