import { useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { AccountPage, Button, Notice, TextField } from '~/client/features/account/ui'
import { Modal } from '~/client/features/admin/ConfirmDialog'
import type { ReposState, RepoView } from '~/shared/github-repos/contract'
import { parseRepoUrl } from '~/shared/github-repos/github-url'
import {
  agoText,
  canRetry,
  countText,
  EMPTY_LIST_TEXT,
  GONE_TEXT,
  type RepoProblem,
  refLabel,
  refName,
  refreshedText,
  removeQuestion,
  repoProblemText,
  shortSha,
} from './repo-messages'
import { type RepoFailure, repoHref } from './repos-client'
import { useRepos } from './use-repos'

const INTRO =
  'Read public GitHub repositories here. Folio shows them as they were at the last refresh, and never changes anything on GitHub.'

function Ago({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString('en-GB')} suppressHydrationWarning>
      {agoText(iso)}
    </time>
  )
}

const code = 'rounded bg-inset px-1.5 py-0.5 font-mono text-[0.9em] text-ink'

export function RefLine({ repo }: { repo: RepoView }) {
  const name = refName(repo)
  return (
    <>
      {refLabel(repo)} <code className={code}>{repo.refKind === 'commit' ? shortSha(name) : name}</code>
    </>
  )
}

export function VersionLine({ repo }: { repo: RepoView }) {
  return (
    <>
      Updated to <code className={code}>{shortSha(repo.commit)}</code> · checked <Ago iso={repo.checkedAt} />
    </>
  )
}

interface Problem {
  problem: RepoProblem
  retryAt?: string | null
}

const problemOf = (failure: RepoFailure | undefined, problem: RepoProblem): Problem => ({
  problem,
  retryAt: failure?.retryAt,
})

function AddForm({ onAdd }: { onAdd: ReturnType<typeof useRepos>['add'] }) {
  const [url, setUrl] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<(Problem & { existingId?: string }) | null>(null)

  const submit = async () => {
    const parsed = parseRepoUrl(url)
    if (!parsed.ok) {
      setError({ problem: parsed.reason })
      return
    }
    setChecking(true)
    setError(null)
    const result = await onAdd(url)
    setChecking(false)
    if (result.ok) setUrl('')
    else setError({ ...problemOf(result.failure, result.problem), existingId: result.failure?.existingId })
  }

  return (
    <form
      className="mt-8"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField
          label="Repository address"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/owner/repository"
          className="min-w-0 flex-1"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'repos-add-error' : undefined}
          data-testid="repos-url"
        />
        <Button data-testid="repos-add" disabled={checking} aria-busy={checking || undefined} className="shrink-0">
          {checking ? 'Checking…' : 'Add'}
        </Button>
      </div>
      {error && (
        <Notice kind="error" id="repos-add-error" data-testid="repos-add-error">
          {repoProblemText(error.problem, error.retryAt)}
          {error.problem === 'exists' && error.existingId && (
            <>
              {' '}
              <AppLink
                href={repoHref(error.existingId)}
                className="font-semibold underline underline-offset-2"
                data-testid="repos-open-existing"
              >
                Open it
              </AppLink>
            </>
          )}
          {canRetry(error.problem) && (
            <>
              {' '}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => void submit()}
                data-testid="repos-add-retry"
              >
                Retry
              </button>
            </>
          )}
        </Notice>
      )}
    </form>
  )
}

function RepoCard({
  repo,
  path,
  onRefresh,
  onRemove,
}: {
  repo: RepoView
  path: string | undefined
  onRefresh: ReturnType<typeof useRepos>['refresh']
  onRemove: (repo: RepoView) => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState<{ changed: boolean } | null>(null)
  const [error, setError] = useState<Problem | null>(null)

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    setStatus(null)
    const result = await onRefresh(repo.id)
    setRefreshing(false)
    if (result.ok) setStatus({ changed: result.value.changed })
    else setError(problemOf(result.failure, result.problem))
  }

  return (
    <li className="rounded-[22px] border border-line bg-surface p-5 md:p-6" data-testid="repo-card" data-key={repo.id}>
      <h2 className="font-display text-[20px] font-bold tracking-[-0.01em] text-ink break-words">
        <AppLink
          href={repoHref(repo.id, path)}
          className="underline-offset-4 hover:text-accent hover:underline"
          data-testid="repo-open"
        >
          {repo.owner}/{repo.name}
        </AppLink>
      </h2>
      {repo.description && <p className="mt-2 text-[15px] leading-relaxed text-body">{repo.description}</p>}
      <p className="mt-3 text-[14px] text-muted">
        <RefLine repo={repo} />
      </p>
      <p className="mt-1 text-[14px] text-muted">
        <VersionLine repo={repo} />
      </p>
      {repo.goneAt && (
        <Notice kind="warning" data-testid="repo-gone">
          {GONE_TEXT}
        </Notice>
      )}
      {status && (
        <Notice kind="success" data-testid="repo-refreshed">
          {refreshedText(status.changed, repo.commit)}
        </Notice>
      )}
      {error && (
        <Notice kind="error" data-testid="repo-error">
          {repoProblemText(error.problem, error.retryAt)}
        </Notice>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={refreshing}
          aria-busy={refreshing || undefined}
          onClick={() => void refresh()}
          data-testid="repo-refresh"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
        <Button type="button" variant="danger" onClick={() => onRemove(repo)} data-testid="repo-remove">
          Remove
        </Button>
      </div>
    </li>
  )
}

function RemoveDialog({
  repo,
  onClose,
  onRemove,
}: {
  repo: RepoView | null
  onClose: () => void
  onRemove: ReturnType<typeof useRepos>['remove']
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<Problem | null>(null)
  const confirm = async () => {
    if (!repo) return
    setSending(true)
    setError(null)
    const result = await onRemove(repo.id)
    setSending(false)
    if (result.ok) onClose()
    else setError(problemOf(result.failure, result.problem))
  }
  return (
    <Modal
      open={repo !== null}
      labelledBy="repo-remove-title"
      onClose={() => {
        setError(null)
        onClose()
      }}
    >
      {repo && (
        <>
          <h2 id="repo-remove-title" className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
            Remove repository
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{removeQuestion(repo)}</p>
          {error && (
            <Notice kind="error" data-testid="repo-remove-error">
              {repoProblemText(error.problem, error.retryAt)}
            </Notice>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="danger"
              disabled={sending}
              aria-busy={sending || undefined}
              onClick={() => void confirm()}
              data-testid="repo-remove-confirm"
            >
              Remove
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} data-testid="repo-remove-cancel">
              Cancel
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function ReposList({ initial }: { initial: readonly RepoView[] }) {
  const { repos, paths, add, refresh, remove } = useRepos(initial)
  const [removing, setRemoving] = useState<RepoView | null>(null)
  return (
    <>
      <AddForm onAdd={add} />
      <p className="mt-10 text-[14px] font-medium text-muted" data-testid="repos-count">
        {countText(repos.length)}
      </p>
      {repos.length === 0 ? (
        <p className="mt-4 text-[15px] text-body" data-testid="repos-empty">
          {EMPTY_LIST_TEXT}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {repos.map((repo) => (
            <RepoCard key={repo.id} repo={repo} path={paths[repo.id]} onRefresh={refresh} onRemove={setRemoving} />
          ))}
        </ul>
      )}
      <RemoveDialog repo={removing} onClose={() => setRemoving(null)} onRemove={remove} />
    </>
  )
}

export function ReposPage({ state }: { state: ReposState }) {
  return (
    <AccountPage eyebrow="Account" title="Repositories" titleTestId="repos-title" lead={INTRO}>
      {state.state === 'ready' ? (
        <ReposList key={state.repos.map((r) => `${r.id}@${r.checkedAt}`).join()} initial={state.repos} />
      ) : (
        <Notice kind="error" data-testid="repos-error">
          {repoProblemText(state.state === 'signed_out' ? 'signed_out' : 'failed')}
        </Notice>
      )}
    </AccountPage>
  )
}
