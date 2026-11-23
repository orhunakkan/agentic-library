import { ChevronRight, File, FileSymlink, Folder, FolderGit2, LoaderCircle } from 'lucide-react'
import { AppLink } from '~/client/components/AppLink'
import { cn } from '~/client/lib/cn'
import type { RepoEntry } from '~/shared/github-repos/contract'
import { repoHref } from './repos-client'

export interface TreeState {
  folders: Readonly<Record<string, readonly RepoEntry[]>>
  expanded: ReadonlySet<string>
  loading: ReadonlySet<string>
}

const row =
  'flex min-h-9 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-[14px] leading-tight text-body transition hover:bg-panel/60 hover:text-ink'

function Entries({
  repoId,
  folder,
  depth,
  state,
  currentPath,
  onToggle,
  onNavigate,
}: {
  repoId: string
  folder: string
  depth: number
  state: TreeState
  currentPath: string
  onToggle: (path: string) => void
  onNavigate?: () => void
}) {
  const entries = state.folders[folder]
  if (!entries) return null
  const indent = { paddingLeft: `${0.5 + depth * 0.9}rem` }
  return (
    <ul className="flex flex-col gap-px">
      {entries.map((entry) => {
        if (entry.kind === 'folder') {
          const open = state.expanded.has(entry.path)
          return (
            <li key={entry.path}>
              <button
                type="button"
                className={row}
                style={indent}
                aria-expanded={open}
                onClick={() => onToggle(entry.path)}
                data-testid="repo-tree-folder"
                data-key={entry.path}
              >
                {state.loading.has(entry.path) ? (
                  <LoaderCircle className="size-3.5 shrink-0 animate-spin text-subtle" aria-hidden />
                ) : (
                  <ChevronRight
                    className={cn('size-3.5 shrink-0 text-subtle transition-transform', open && 'rotate-90')}
                    aria-hidden
                  />
                )}
                <Folder className="size-4 shrink-0 text-subtle" aria-hidden />
                <span className="truncate">{entry.name}</span>
              </button>
              {open && (
                <Entries
                  repoId={repoId}
                  folder={entry.path}
                  depth={depth + 1}
                  state={state}
                  currentPath={currentPath}
                  onToggle={onToggle}
                  onNavigate={onNavigate}
                />
              )}
            </li>
          )
        }
        const Icon = entry.kind === 'link' ? FileSymlink : entry.kind === 'submodule' ? FolderGit2 : File
        const current = entry.path === currentPath
        return (
          <li key={entry.path}>
            <AppLink
              href={repoHref(repoId, entry.path)}
              className={cn(row, current && 'bg-panel font-semibold text-ink')}
              style={{ paddingLeft: `${1.45 + depth * 0.9}rem` }}
              aria-current={current ? 'page' : undefined}
              onClick={onNavigate}
              data-testid="repo-tree-file"
              data-key={entry.path}
            >
              <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
              <span className="truncate">{entry.name}</span>
            </AppLink>
          </li>
        )
      })}
    </ul>
  )
}

export function RepoTree({
  repoId,
  state,
  currentPath,
  onToggle,
  onNavigate,
  className,
}: {
  repoId: string
  state: TreeState
  currentPath: string
  onToggle: (path: string) => void
  onNavigate?: () => void
  className?: string
}) {
  return (
    <nav aria-label="Files" className={className}>
      <Entries
        repoId={repoId}
        folder=""
        depth={0}
        state={state}
        currentPath={currentPath}
        onToggle={onToggle}
        onNavigate={onNavigate}
      />
    </nav>
  )
}
