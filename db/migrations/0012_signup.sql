-- One sign-up link: `email` (mailed by open sign-up; makes an account with that address confirmed) or `invite`
-- (made by an admin on the Users page; shown once). Only the token's SHA-256 is stored. A row is used once
-- (used_at, used_by), dead after expires_at, revoked_at or 10 refused attempts. Deleting the admin who made an
-- invite deletes it; deleting the account it made keeps it with used_by null. Swept when a link is created.
create table signup_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  kind text not null check (kind in ('email', 'invite')),
  email text check (char_length(email) between 3 and 254),
  note text check (char_length(note) between 1 and 60),
  created_by bigint references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by bigint references users (id) on delete set null,
  revoked_at timestamptz,
  bounced_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 10),
  check ((kind = 'email') = (email is not null)),
  check (kind = 'invite' or (note is null and created_by is null))
);
create index signup_tokens_kind_created_idx on signup_tokens (kind, created_at);
create index signup_tokens_email_idx on signup_tokens (lower(email), created_at) where email is not null;
