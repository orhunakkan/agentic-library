import { useRouteContext, useRouter } from '@tanstack/react-router'
import { CloudOff, ExternalLink, FolderTree, Play, RefreshCw, X } from 'lucide-react'
import { type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppLink } from '~/client/components/AppLink'
import { Button, Notice } from '~/client/features/account/ui'
import { RunCodeContext } from '~/client/features/run-code/RunButtons'
import { RunDialog, type RunTarget, useRunEdits } from '~/client/features/run-code/RunDialog'
import { runAccess } from '~/client/features/run-code/run-access'
import { openLabel } from '~/client/features/run-code/run-messages'
import { cn } from '~/client/lib/cn'
import { getRepoFolder } from '~/server/account-functions'
import type { RepoEntry, RepoFile, RepoFolder, RepoView, RepoViewState } from '~/shared/github-repos/contract'
import { githubBlobUrl } from '~/shared/github-repos/github-url'
import type { RenderedMarkdown } from '~/shared/github-repos/md-node'
import { fileLang } from '~/shared/run-code/langs'
import { CodeLines, codeText } from './CodeView'
import { MdView } from './MdView'
import { RepoDownload } from './RepoDownload'
import { RefLine, VersionLine } from './ReposPage'
import { RepoTree, type TreeState } from './RepoTree'
import {
  CAPPED_TEXT,
  EMPTY_REPO_TEXT,
  externalImagesText,
  GONE_TEXT,
  linesText,
  MISSING_FILE_TEXT,
  noticeText,
  OFFLINE_CHIP_TEXT,
  OFFLINE_MISSING_TEXT,
  OFFLINE_TITLE,
  PICTURES_OFFLINE_TEXT,
  type RepoProblem,
  refreshedText,
  repoProblemText,
  sizeText,
} from './repo-messages'
import { refreshRepo, repoHref, repoRawHref } from './repos-client'

type Ready = Extract<RepoViewState, { state: 'ready' }>

const parentsOf = (path: string) => {
  const parts = path ? path.split('/') : []
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

function useTree(repoId: string, data: Ready, path: string) {
  const [folders, setFolders] = useState<Record<string, readonly RepoEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const loaded: Record<string, readonly RepoEntry[]> = { ...folders }
  for (const folder of data.folders) loaded[folder.path] = folder.entries

  const commit = data.repo.commit
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new commit is the trigger, not a value used inside.
  useEffect(() => setFolders({}), [commit])
  useEffect(() => {
    const target = data.target.kind === 'folder' ? path : path.split('/').slice(0, -1).join('/')
    setExpanded((open) => new Set([...open, ...parentsOf(target)]))
  }, [path, data.target.kind])

  const toggle = async (folder: string) => {
    if (expanded.has(folder)) {
      setExpanded((open) => new Set([...open].filter((p) => p !== folder)))
      return
    }
    setExpanded((open) => new Set(open).add(folder))
    if (loaded[folder]) return
    setLoading((l) => new Set(l).add(folder))
    try {
      const state = await getRepoFolder({ data: { id: repoId, path: folder } })
      if (state.state === 'ready') setFolders((f) => ({ ...f, [folder]: state.entries }))
    } finally {
      setLoading((l) => new Set([...l].filter((p) => p !== folder)))
    }
  }
  const state: TreeState = { folders: loaded, expanded, loading }
  return { state, toggle }
}

function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop is a mouse shortcut; Escape closes it through the dialog's cancel event.
    <dialog
      ref={ref}
      aria-label="Files"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="m-0 h-dvh max-h-dvh w-[min(22rem,88vw)] max-w-none border-r border-line bg-inset p-0 text-ink backdrop:bg-black/40"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-semibold text-ink">Files</p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink"
              aria-label="Close files"
              data-testid="repo-files-close"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
        </div>
      )}
    </dialog>
  )
}

function Breadcrumbs({ repo, path }: { repo: RepoView; path: string }) {
  const crumbs = [
    { label: repo.name, path: '' },
    ...parentsOf(path).map((parent) => ({ label: parent.slice(parent.lastIndexOf('/') + 1), path: parent })),
  ]
  return (
    <nav aria-label="Breadcrumbs" data-testid="repo-breadcrumbs" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[15px]">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={crumb.path} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <span className="text-subtle" aria-hidden>
                  /
                </span>
              )}
              <AppLink
                href={repoHref(repo.id, crumb.path)}
                aria-current={last ? 'page' : undefined}
                className={cn('break-all hover:underline', last ? 'font-semibold text-ink' : 'text-accent')}
                data-testid="repo-breadcrumb"
                data-key={crumb.path}
              >
                {crumb.label}
              </AppLink>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Offline, the pictures the copy kept, which are the only ones that show; null online, when every picture does. */
type Offline = { pictures: ReadonlySet<string> } | null

function Rendered({
  repoId,
  markdown,
  testId,
  offline,
}: {
  repoId: string
  markdown: RenderedMarkdown
  testId: string
  offline: Offline
}) {
  const [showExternal, setShowExternal] = useState(false)
  return (
    <>
      {markdown.externalImages > 0 && !showExternal && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-line bg-inset px-4 py-3 text-[14.5px] text-body sm:flex-row sm:items-center sm:justify-between">
          <p>{externalImagesText(markdown.externalImages)}</p>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            onClick={() => setShowExternal(true)}
            data-testid="repo-show-external"
          >
            Show pictures from other sites
          </Button>
        </div>
      )}
      <div className="max-w-[60rem]" data-testid={testId}>
        <MdView
          repoId={repoId}
          nodes={markdown.nodes}
          frontMatter={markdown.frontMatter}
          showExternal={showExternal}
          pictureShows={(picture) => !offline || offline.pictures.has(picture)}
        />
      </div>
    </>
  )
}

function FileNotice({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-xl border border-line bg-inset px-4 py-6 text-center text-[15px] text-body"
      data-testid="repo-file-notice"
    >
      {children}
    </p>
  )
}

const tab = (active: boolean) =>
  cn(
    'inline-flex h-9 items-center rounded-lg px-3 text-[14px] font-semibold transition',
    active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
  )

function FileBody({ repo, file, offline }: { repo: RepoView; file: RepoFile; offline: Offline }) {
  const { content } = file
  if (content.kind === 'markdown' && content.view === 'preview')
    return (
      <Rendered key={file.path} repoId={repo.id} markdown={content.markdown} testId="repo-file" offline={offline} />
    )
  if (content.kind === 'markdown' || content.kind === 'code')
    return (
      <>
        {content.capped && (
          <p className="mb-3 text-[14px] text-muted" data-testid="repo-file-notice">
            {CAPPED_TEXT}
          </p>
        )}
        <CodeLines code={content.code} data-testid="repo-file" />
      </>
    )
  if (content.kind === 'picture' && offline && !offline.pictures.has(file.path))
    return <FileNotice>{PICTURES_OFFLINE_TEXT}.</FileNotice>
  if (content.kind === 'picture')
    return (
      <div className="flex justify-center rounded-xl border border-line bg-inset p-4" data-testid="repo-file">
        <img src={repoRawHref(repo.id, file.path)} alt={file.name} className="max-h-[70vh] max-w-full object-contain" />
      </div>
    )
  if (content.notice === 'link')
    return (
      <FileNotice>
        {noticeText(content)}{' '}
        {content.targetPath !== null ? (
          <AppLink
            href={repoHref(repo.id, content.targetPath)}
            className="font-mono text-accent underline"
            data-testid="repo-link-target"
          >
            {content.target}
          </AppLink>
        ) : (
          <code className="font-mono">{content.target}</code>
        )}
      </FileNotice>
    )
  return <FileNotice>{noticeText(content)}</FileNotice>
}

function FileView({ repo, file, offline }: { repo: RepoView; file: RepoFile; offline: Offline }) {
  const { content } = file
  const markdown = content.kind === 'markdown'
  const info = [sizeText(file.size), file.lines !== null ? linesText(file.lines) : null].filter(Boolean).join(' · ')
  const run = useContext(RunCodeContext)
  const runLang = run && content.kind === 'code' && !content.capped ? fileLang(file.path) : null

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-2.5">
        <p className="min-w-0 text-[14px] text-muted" data-testid="repo-file-info">
          <span className="break-all font-semibold text-ink">{file.name}</span> · {info}
        </p>
        {runLang && run && content.kind === 'code' && (
          <button
            type="button"
            data-testid="repo-run"
            aria-label={openLabel(runLang)}
            onClick={(e) =>
              run.open({ lang: runLang, code: codeText(content.code), key: 'file', opener: e.currentTarget })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[14px] font-semibold text-ink transition hover:border-accent-line hover:bg-panel"
          >
            <Play className="size-3.5" aria-hidden />
            Run
          </button>
        )}
        {markdown && !offline && (
          <nav className="flex gap-1 rounded-xl bg-inset p-1" aria-label="View">
            <AppLink
              href={repoHref(repo.id, file.path)}
              className={tab(content.view === 'preview')}
              aria-current={content.view === 'preview' ? 'page' : undefined}
              data-testid="repo-view-preview"
            >
              Preview
            </AppLink>
            <AppLink
              href={repoHref(repo.id, file.path, 'code')}
              className={tab(content.view === 'code')}
              aria-current={content.view === 'code' ? 'page' : undefined}
              data-testid="repo-view-code"
            >
              Code
            </AppLink>
          </nav>
        )}
      </div>
      <FileBody repo={repo} file={file} offline={offline} />
    </div>
  )
}

function FolderView({ repo, folder, offline }: { repo: RepoView; folder: RepoFolder; offline: Offline }) {
  return (
    <div>
      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
        {folder.entries.map((entry) => (
          <li key={entry.path}>
            <AppLink
              href={repoHref(repo.id, entry.path)}
              className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-[15px] text-ink hover:bg-panel/60"
              data-testid="repo-entry"
              data-key={entry.path}
            >
              <span className="min-w-0 break-all">
                {entry.name}
                {entry.kind === 'folder' && <span className="text-subtle">/</span>}
              </span>
              {entry.kind === 'file' && entry.size !== null && (
                <span className="shrink-0 text-[13px] text-muted">{sizeText(entry.size)}</span>
              )}
            </AppLink>
          </li>
        ))}
      </ul>
      {folder.readme && (
        <section className="mt-6 rounded-xl border border-line bg-surface p-5 md:p-8" aria-label={folder.readme.path}>
          <Rendered
            key={folder.readme.path}
            repoId={repo.id}
            markdown={folder.readme.markdown}
            testId="repo-readme"
            offline={offline}
          />
        </section>
      )}
    </div>
  )
}

function Target({ data, repo, offline }: { data: Ready; repo: RepoView; offline: Offline }) {
  const { target } = data
  if (target.kind === 'folder') return <FolderView repo={repo} folder={target.folder} offline={offline} />
  if (target.kind === 'file') return <FileView repo={repo} file={target.file} offline={offline} />
  if (target.kind === 'empty') return <FileNotice>{EMPTY_REPO_TEXT}</FileNotice>
  if (target.kind === 'gone') return <FileNotice>{GONE_TEXT}</FileNotice>
  return (
    <FileNotice>
      {MISSING_FILE_TEXT}{' '}
      <AppLink href={repoHref(repo.id)} className="font-semibold text-accent underline" data-testid="repo-back">
        Back to the repository.
      </AppLink>
    </FileNotice>
  )
}

function useRefresh(repoId: string, loaded: Ready['refreshed']) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshed, setRefreshed] = useState(loaded)
  const [error, setError] = useState<{ problem: RepoProblem; retryAt?: string | null } | null>(null)
  useEffect(() => setRefreshed(loaded), [loaded])

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    setRefreshed(null)
    const result = await refreshRepo(repoId)
    if (result.ok) {
      await router.invalidate()
      setRefreshed({ changed: result.value.changed })
    } else setError({ problem: result.problem, retryAt: result.failure?.retryAt })
    setRefreshing(false)
  }
  return { refreshing, refreshed, error, refresh }
}

export function RepoViewer({
  data,
  path,
  offline: copy = null,
}: {
  data: Ready
  path: string
  offline?: { pictures: readonly string[] } | null
}) {
  const repo = data.repo
  const offline: Offline = useMemo(() => (copy ? { pictures: new Set(copy.pictures) } : null), [copy])
  const { state, toggle } = useTree(repo.id, data, path)
  const [drawer, setDrawer] = useState(false)
  const { refreshing, refreshed, error, refresh } = useRefresh(repo.id, data.refreshed)

  const isFile = data.target.kind === 'file'
  const onGitHub = githubBlobUrl(
    repo.owner,
    repo.name,
    repo.commit,
    isFile || data.target.kind === 'folder' ? path : '',
    isFile ? 'blob' : 'tree',
  )
  const tree = <RepoTree repoId={repo.id} state={state} currentPath={path} onToggle={(p) => void toggle(p)} />
  const viewer = useRouteContext({ from: '__root__' }).viewer
  const [runTarget, setRunTarget] = useState<RunTarget | null>(null)
  const runEdits = useRunEdits(`${repo.id}:${repo.commit}:${path}`)
  const runCode = useMemo(() => ({ open: setRunTarget }), [])

  return (
    <main
      id="main"
      className="mx-auto w-full max-w-[1400px] px-4 pt-8 md:px-8 md:pt-12"
      style={{ paddingBottom: 'calc(96px + var(--player-h))' }}
    >
      <header className="flex flex-col gap-4 border-b border-line pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow text-accent">
              <AppLink href="/account/repos" className="hover:underline" data-testid="repo-all">
                Repositories
              </AppLink>
            </p>
            <h1
              className="mt-2 break-words font-display text-[clamp(26px,3vw,38px)] leading-[1.1] font-bold tracking-[-0.02em] text-ink"
              data-testid="repo-title"
            >
              {repo.owner}/{repo.name}
            </h1>
            {offline && (
              <span
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-inset px-3 text-[13px] font-medium text-muted"
                data-testid="repo-offline"
              >
                <CloudOff className="size-4" aria-hidden />
                {OFFLINE_CHIP_TEXT}
              </span>
            )}
            {repo.description && <p className="mt-2 max-w-[70ch] text-[15px] text-body">{repo.description}</p>}
            <p className="mt-2 text-[14px] text-muted">
              <RefLine repo={repo} />
            </p>
            <p className="mt-1 text-[14px] text-muted" data-testid="repo-version">
              <VersionLine repo={repo} />
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="lg:hidden"
              onClick={() => setDrawer(true)}
              data-testid="repo-files-toggle"
            >
              <FolderTree className="size-4" aria-hidden />
              Files
            </Button>
            {!offline && (
              <Button
                type="button"
                variant="secondary"
                disabled={refreshing}
                aria-busy={refreshing || undefined}
                onClick={() => void refresh()}
                data-testid="repo-refresh"
              >
                <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            )}
            <a
              href={onGitHub}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-[15px] font-semibold text-ink transition hover:border-accent-line hover:bg-panel"
              data-testid="repo-on-github"
            >
              <ExternalLink className="size-4" aria-hidden />
              Open on GitHub
            </a>
          </div>
        </div>
        {!offline && !repo.goneAt && data.target.kind !== 'empty' && data.target.kind !== 'gone' && (
          <RepoDownload repo={repo} />
        )}
        {refreshed && (
          <Notice kind="success" data-testid="repo-refreshed">
            {refreshedText(refreshed.changed, repo.commit)}
          </Notice>
        )}
        {error && (
          <Notice kind="error" data-testid="repo-error">
            {repoProblemText(error.problem, error.retryAt)}
          </Notice>
        )}
        {repo.goneAt && (
          <Notice kind="warning" data-testid="repo-gone">
            {GONE_TEXT}
          </Notice>
        )}
      </header>

      <div className="mt-6 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-xl border border-line bg-inset p-2">
            {tree}
          </div>
        </aside>
        <div className="min-w-0">
          <div className="mb-4">
            <Breadcrumbs repo={repo} path={path} />
          </div>
          <RunCodeContext.Provider value={runCode}>
            <Target data={data} repo={repo} offline={offline} />
          </RunCodeContext.Provider>
        </div>
      </div>

      <RunDialog target={runTarget} access={runAccess(viewer)} edits={runEdits} onClose={() => setRunTarget(null)} />
      <Drawer open={drawer} onClose={() => setDrawer(false)}>
        <RepoTree
          repoId={repo.id}
          state={state}
          currentPath={path}
          onToggle={(p) => void toggle(p)}
          onNavigate={() => setDrawer(false)}
        />
      </Drawer>
    </main>
  )
}

export function RepoUnavailable({ state }: { state: Exclude<RepoViewState, Ready> }) {
  const router = useRouter()
  const problem: RepoProblem = state.state === 'not_found' ? 'unavailable' : state.state
  return (
    <main id="main" className="mx-auto w-full max-w-[720px] px-4 pt-12 md:px-8 md:pt-16">
      <p className="eyebrow text-accent">
        <AppLink href="/account/repos" className="hover:underline" data-testid="repo-all">
          Repositories
        </AppLink>
      </p>
      <h1
        className="mt-3 font-display text-[clamp(30px,4vw,42px)] font-bold tracking-[-0.03em] text-ink"
        data-testid="repo-title"
      >
        Repository
      </h1>
      <Notice kind="error" data-testid="repo-error">
        {repoProblemText(problem, state.state === 'busy' ? state.retryAt : null)}
      </Notice>
      <Button
        type="button"
        variant="secondary"
        className="mt-6"
        onClick={() => void router.invalidate()}
        data-testid="repo-retry"
      >
        Retry
      </Button>
    </main>
  )
}

/** What the repository page shows offline when this device has no copy of it. */
export function RepoOffline() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center"
      style={{ paddingBottom: 'var(--player-h)' }}
    >
      <h1
        data-testid="repo-offline-title"
        className="font-display text-[clamp(34px,4vw,48px)] leading-[1.05] font-bold tracking-[-0.03em] text-balance text-ink"
      >
        {OFFLINE_TITLE}
      </h1>
      <p className="mt-3 text-muted">{OFFLINE_MISSING_TEXT}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        <button
          type="button"
          data-testid="repo-offline-retry"
          onClick={() => window.location.reload()}
          className="inline-flex h-12 items-center rounded-xl bg-accent-fill px-6 text-[15px] font-semibold text-on-accent transition hover:brightness-105"
        >
          Try again
        </button>
        <a
          href="/offline.html"
          data-testid="repo-offline-downloads"
          className="text-[15px] font-medium text-ink underline underline-offset-4"
        >
          Downloads
        </a>
      </div>
    </main>
  )
}
