import type { CodeTokens, RenderedMarkdown } from './md-node.ts'

export const MAX_REPOS = 25

export const MAX_REPO_URL_LENGTH = 500

export type RepoUrlProblem = 'empty' | 'too_long' | 'not_url' | 'not_github' | 'not_repository'

export type RepoErrorCode =
  | 'signed_out'
  | 'invalid'
  | 'not_found'
  | 'ref_not_found'
  | 'exists'
  | 'quota'
  | 'limited'
  | 'busy'
  | 'unavailable'
  | 'failed'

export interface RepoView {
  id: string
  owner: string
  name: string
  description: string | null
  ref: string | null
  refKind: 'default' | 'branch' | 'tag' | 'commit'
  defaultBranch: string
  commit: string
  addedAt: string
  checkedAt: string
  goneAt: string | null
}

export type RepoEntryKind = 'folder' | 'file' | 'link' | 'submodule'

export interface RepoEntry {
  name: string
  path: string
  kind: RepoEntryKind
  size: number | null
}

export type RepoFileNotice =
  | { notice: 'too-large'; size: number }
  | { notice: 'binary'; size: number }
  | { notice: 'lfs' }
  | { notice: 'submodule' }
  | { notice: 'link'; target: string; targetPath: string | null }

export type RepoFileContent =
  | { kind: 'markdown'; view: 'preview'; markdown: RenderedMarkdown }
  | { kind: 'markdown'; view: 'code'; code: CodeTokens; capped: boolean }
  | { kind: 'code'; code: CodeTokens; capped: boolean }
  | { kind: 'picture' }
  | ({ kind: 'notice' } & RepoFileNotice)

export interface RepoFile {
  path: string
  name: string
  size: number
  lines: number | null
  content: RepoFileContent
}

export interface RepoFolder {
  path: string
  entries: RepoEntry[]
  readme: { path: string; markdown: RenderedMarkdown } | null
}

export type RepoTarget =
  | { kind: 'folder'; folder: RepoFolder }
  | { kind: 'file'; file: RepoFile }
  | { kind: 'missing' }
  | { kind: 'empty' }
  | { kind: 'gone' }

export type RepoReadProblem =
  | { state: 'signed_out' }
  | { state: 'not_found' }
  | { state: 'unavailable' }
  | { state: 'busy'; retryAt: string | null }
  | { state: 'limited' }

export type ReposState = RepoReadProblem | { state: 'ready'; repos: RepoView[] }

export type RepoViewState =
  | RepoReadProblem
  | {
      state: 'ready'
      repo: RepoView
      folders: { path: string; entries: RepoEntry[] }[]
      target: RepoTarget
      refreshed: { changed: boolean } | null
    }

export type RepoFolderState = RepoReadProblem | { state: 'ready'; entries: RepoEntry[] }
