import '@tanstack/react-start/server-only'
import { MAX_REPOS } from '../../shared/github-repos/contract.ts'
import { isUuid } from '../../shared/uuid.ts'
import type { Db, Pool } from '../db.ts'

export type RefKind = 'branch' | 'tag' | 'commit'

export interface RepoRow {
  id: string
  githubId: number
  owner: string
  name: string
  ref: string | null
  refKind: RefKind | null
  defaultBranch: string
  description: string | null
  commitSha: string
  addedAt: Date
  checkedAt: Date
  openedAt: Date | null
  goneAt: Date | null
}

interface RawRepo {
  id: string
  github_id: string
  owner: string
  name: string
  ref: string | null
  ref_kind: RefKind | null
  default_branch: string
  description: string | null
  commit_sha: string
  added_at: Date
  checked_at: Date
  opened_at: Date | null
  gone_at: Date | null
}

const toRow = (repo: RawRepo): RepoRow => ({
  id: repo.id,
  githubId: Number(repo.github_id),
  owner: repo.owner,
  name: repo.name,
  ref: repo.ref,
  refKind: repo.ref_kind,
  defaultBranch: repo.default_branch,
  description: repo.description,
  commitSha: repo.commit_sha,
  addedAt: repo.added_at,
  checkedAt: repo.checked_at,
  openedAt: repo.opened_at,
  goneAt: repo.gone_at,
})

const COLUMNS = (db: Db) =>
  db`id, github_id, owner, name, ref, ref_kind, default_branch, description, commit_sha, added_at, checked_at,
    opened_at, gone_at`

export interface RepoFacts {
  owner: string
  name: string
  defaultBranch: string
  description: string | null
  commitSha: string
}

export interface NewRepo extends RepoFacts {
  githubId: number
  ref: string | null
  refKind: RefKind | null
}

export type AddResult = RepoRow | { exists: string } | 'quota'

export function addRepo(pool: Pool, userId: number, repo: NewRepo): Promise<AddResult> {
  return pool.begin(async (tx): Promise<AddResult> => {
    await tx`select id from users where id = ${userId} for update`
    const [existing] = await tx<{ id: string }[]>`
      select id from github_repos
      where user_id = ${userId} and github_id = ${repo.githubId} and coalesce(ref, '') = ${repo.ref ?? ''}`
    if (existing) return { exists: existing.id }
    const [count] = await tx<{ n: string }[]>`select count(*) as n from github_repos where user_id = ${userId}`
    if (Number(count?.n ?? 0) >= MAX_REPOS) return 'quota'
    const [row] = await tx<RawRepo[]>`
      insert into github_repos (user_id, github_id, owner, name, ref, ref_kind, default_branch, description, commit_sha)
      values (${userId}, ${repo.githubId}, ${repo.owner}, ${repo.name}, ${repo.ref}, ${repo.refKind},
        ${repo.defaultBranch}, ${repo.description}, ${repo.commitSha})
      returning ${COLUMNS(tx)}`
    return toRow(row as RawRepo)
  })
}

export async function listRepos(db: Db, userId: number): Promise<RepoRow[]> {
  const rows = await db<RawRepo[]>`
    select ${COLUMNS(db)} from github_repos where user_id = ${userId} order by added_at desc, id`
  return rows.map(toRow)
}

export async function findRepo(db: Db, userId: number, id: string): Promise<RepoRow | null> {
  if (!isUuid(id)) return null
  const [row] = await db<RawRepo[]>`select ${COLUMNS(db)} from github_repos where id = ${id} and user_id = ${userId}`
  return row ? toRow(row) : null
}

export async function markChecked(db: Db, userId: number, id: string, facts: RepoFacts): Promise<RepoRow | null> {
  const [row] = await db<RawRepo[]>`
    update github_repos set owner = ${facts.owner}, name = ${facts.name}, default_branch = ${facts.defaultBranch},
      description = ${facts.description}, commit_sha = ${facts.commitSha}, checked_at = now(), gone_at = null
    where id = ${id} and user_id = ${userId}
    returning ${COLUMNS(db)}`
  return row ? toRow(row) : null
}

export async function markGone(db: Db, userId: number, id: string): Promise<RepoRow | null> {
  const [row] = await db<RawRepo[]>`
    update github_repos set gone_at = coalesce(gone_at, now()), checked_at = now()
    where id = ${id} and user_id = ${userId}
    returning ${COLUMNS(db)}`
  return row ? toRow(row) : null
}

export async function markOpened(db: Db, userId: number, id: string): Promise<void> {
  await db`
    update github_repos set opened_at = now()
    where id = ${id} and user_id = ${userId} and (opened_at is null or opened_at < now() - interval '1 minute')`
}

export async function removeRepo(db: Db, userId: number, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const result = await db`delete from github_repos where id = ${id} and user_id = ${userId}`
  return result.count > 0
}
