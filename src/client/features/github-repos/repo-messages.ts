import { timeOfDay } from '~/client/lib/format'
import type { RepoErrorCode, RepoFileNotice, RepoUrlProblem, RepoView } from '~/shared/github-repos/contract'
import { MAX_REPOS } from '~/shared/github-repos/contract'
import type { RepoTooLarge } from '~/shared/github-repos/offline'
import { formatBytes } from '~/shared/lib/format-bytes'

export type RepoProblem = RepoUrlProblem | Exclude<RepoErrorCode, 'invalid' | 'signed_out'> | 'signed_out'

const EXAMPLE = 'https://github.com/addyosmani/agent-skills'

export const REPO_TEXT: Record<RepoProblem, string> = {
  empty: 'Paste a repository’s address.',
  too_long: 'That address is too long.',
  not_url: `That isn’t a web address. Paste one like ${EXAMPLE}.`,
  not_github: 'Only github.com repositories can be added.',
  not_repository: `That’s not a repository’s address. Paste the repository’s own address, like ${EXAMPLE}.`,
  not_found: 'GitHub has no public repository at that address. It may be private, renamed or deleted.',
  ref_not_found: 'That repository has no branch or tag by that name.',
  exists: 'You already have this repository.',
  quota: `You have ${MAX_REPOS} repositories, the most an account can keep. Remove one to add another.`,
  limited: 'You’ve done that a lot in the last hour. Try again later.',
  busy: 'GitHub is busy or Folio’s share of it is used up.',
  unavailable: 'Couldn’t reach GitHub. Try again.',
  failed: 'Something went wrong. Try again.',
  signed_out: 'Your session has ended. Sign in again.',
}

const RETRYABLE: readonly RepoProblem[] = ['unavailable', 'failed']

export const canRetry = (problem: RepoProblem) => RETRYABLE.includes(problem)

export function repoProblemText(problem: RepoProblem, retryAt?: string | null, timeZone?: string): string {
  const text = REPO_TEXT[problem]
  if (problem !== 'busy') return text
  return retryAt ? `${text} Try again after ${timeOfDay(retryAt, timeZone)}.` : `${text} Try again in a minute.`
}

export const shortSha = (sha: string) => sha.slice(0, 7)

export function refLabel(repo: Pick<RepoView, 'refKind'>): string {
  if (repo.refKind === 'default') return 'Default branch'
  if (repo.refKind === 'branch') return 'Branch'
  if (repo.refKind === 'tag') return 'Tag'
  return 'Commit'
}

export const refName = (repo: Pick<RepoView, 'ref' | 'defaultBranch'>) => repo.ref ?? repo.defaultBranch

export const countText = (count: number) => `${count} of ${MAX_REPOS} repositories`

export const refreshedText = (changed: boolean, commit: string) =>
  changed ? `Updated to ${shortSha(commit)}.` : 'Already up to date.'

export const removeQuestion = (repo: Pick<RepoView, 'owner' | 'name'>) =>
  `Remove ${repo.owner}/${repo.name} from your repositories? Nothing changes on GitHub.`

export const GONE_TEXT = 'GitHub no longer shows this repository. It may have been deleted or made private.'
export const EMPTY_LIST_TEXT = 'You haven’t added a repository yet.'
export const EMPTY_REPO_TEXT = 'This repository is empty.'
export const MISSING_FILE_TEXT = 'This file isn’t in the latest version.'
export const CAPPED_TEXT = 'Highlighting is off for files this large.'

export function sizeText(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const linesText = (lines: number) => (lines === 1 ? '1 line' : `${lines.toLocaleString('en-GB')} lines`)

export function noticeText(notice: RepoFileNotice): string {
  switch (notice.notice) {
    case 'too-large':
      return `This file is too large to show here (${sizeText(notice.size)}). Open it on GitHub.`
    case 'binary':
      return `This is a binary file (${sizeText(notice.size)}).`
    case 'lfs':
      return 'This file is stored with Git LFS, which Folio can’t show.'
    case 'submodule':
      return 'This is a submodule: another repository, which Folio doesn’t open.'
    case 'link':
      return 'Link to'
  }
}

export const externalImagesText = (count: number) =>
  `This file shows ${count === 1 ? '1 picture' : `${count} pictures`} from other sites. Showing them lets those sites see your visit.`

export function agoText(iso: string, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

export const DOWNLOAD_TEXT = 'Download for offline'
export const DOWNLOADED_TOAST = 'Downloaded for offline reading.'
export const DOWNLOAD_REMOVED_TOAST = 'Download removed.'
export const DOWNLOAD_SIGN_OUT_NOTE = 'Removed when you sign out.'
export const DOWNLOAD_FAILED_TEXT = 'Couldn’t download this repository. Check your connection and try again.'

export const downloadedText = (bytes: number) => `Downloaded · ${formatBytes(bytes)}`

export const downloadingLabel = (repo: Pick<RepoView, 'owner' | 'name'>) => `Downloading ${repo.owner}/${repo.name}`

export const noRoomText = (bytes: number) =>
  `There isn’t room on this device for this repository (about ${formatBytes(bytes)}).`

const filesText = (count: number) => (count === 1 ? '1 file' : `${count.toLocaleString('en-GB')} files`)

export function tooLargeText({ files, bytes, maxFiles, maxBytes }: RepoTooLarge): string {
  const most = `Downloads hold up to ${filesText(maxFiles)} and ${formatBytes(maxBytes)} of source.`
  if (files === null || bytes === null)
    return `This repository is too big to download: GitHub lists only part of its files. ${most}`
  return `This repository is too big to download: ${filesText(files)}, ${formatBytes(bytes)} of source. ${most}`
}
