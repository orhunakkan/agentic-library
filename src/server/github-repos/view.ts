import '@tanstack/react-start/server-only'
import type { RepoView } from '../../shared/github-repos/contract.ts'
import type { RepoRow } from './store.ts'

export const EMPTY_COMMIT = '0'.repeat(40)

export function toRepoView(row: RepoRow): RepoView {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    ref: row.ref,
    refKind: row.refKind ?? 'default',
    defaultBranch: row.defaultBranch,
    commit: row.commitSha,
    addedAt: row.addedAt.toISOString(),
    checkedAt: row.checkedAt.toISOString(),
    goneAt: row.goneAt?.toISOString() ?? null,
  }
}
