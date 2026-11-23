-- Access tokens (src/server/access-tokens/): a bearer way in for clients that aren't a browser, beside the session
-- cookie. A row is one token a reader made with their username and password at POST /api/tokens: only the SHA-256 of
-- the whole token (`folio_at_` + 43 base64url characters) is stored, never the token. It has a name the reader chose,
-- a lifetime of 1 to 30 days (expires_at), and ends after 7 days without use, counted from last_used_at (null until
-- its first use) or created_at. The IP and user agent are the creating request's.
--
-- Deleting the user deletes their tokens (cascade). Code also deletes them: when found ended, by the sweep after each
-- sign-in and each new token, on revoking one, and with the sessions wherever those end (endUserAccess).
--
-- Additive only: one table.

create table access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  ip inet,
  user_agent text check (char_length(user_agent) <= 300),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index access_tokens_user_id_idx on access_tokens (user_id);
