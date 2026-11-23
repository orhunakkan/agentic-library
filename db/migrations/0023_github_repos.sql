-- Repositories (src/server/github-repos/): a public GitHub repository a reader added to read in Folio. A row holds
-- what GitHub said about it when it was added or last refreshed: its numeric id (github_id, which survives renames),
-- its owner and name in GitHub's own spelling, the branch, tag or commit the address named (ref and ref_kind, or null
-- for the default branch), the default branch, the description (cut at 350 characters, as GitHub cuts it), and the
-- commit the viewer shows (commit_sha). gone_at is set when a refresh found GitHub no longer shows it, and cleared
-- when one finds it again. No file, folder or tree is ever stored: those come from GitHub and live in memory.
--
-- Deleting the user deletes their repositories (cascade); Remove deletes one.
--
-- Additive only: one table.

create table github_repos (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  github_id bigint not null check (github_id > 0),
  owner text not null check (char_length(owner) between 1 and 39),
  name text not null check (char_length(name) between 1 and 100),
  ref text check (char_length(ref) between 1 and 255),
  ref_kind text check (ref_kind in ('branch', 'tag', 'commit')),
  default_branch text not null check (char_length(default_branch) between 1 and 255),
  description text check (char_length(description) <= 350),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  added_at timestamptz not null default now(),
  checked_at timestamptz not null default now(),
  opened_at timestamptz,
  gone_at timestamptz,
  check ((ref is null) = (ref_kind is null))
);
create unique index github_repos_user_repo_ref_idx on github_repos (user_id, github_id, coalesce(ref, ''));
create index github_repos_user_added_idx on github_repos (user_id, added_at);
