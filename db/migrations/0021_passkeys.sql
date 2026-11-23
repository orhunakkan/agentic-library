-- Passkeys (src/server/passkeys/): a second way to sign in, beside the password, never instead of it.
--
-- users.webauthn_user_id is the account's WebAuthn user handle: 32 random bytes, set the first time it adds a passkey
-- and never changed, so a passkey made for the account always names it. Never the numeric id or the username.
--
-- A passkeys row is one credential: its id and COSE public key as the authenticator gave them, its signature counter,
-- its transports (checked against a fixed list in code), whether it is synced (backed up), and a name the server made
-- from the browser's User-Agent. Deleting the user deletes their passkeys, and so does setting a password without
-- the old one (a reset link, the Users page, users.ts set-password), in code.
--
-- A passkey_challenges row is one challenge Folio handed out: only its SHA-256, what it is for, the user it was made
-- for (registration only), the IP, and when it expires (5 minutes). It is used once (used_at). Rows older than an hour
-- are swept in code whenever a challenge is made and after each sign-in; deleting the user deletes theirs.
--
-- Additive only: one nullable column and two tables.

alter table users add column webauthn_user_id bytea unique;

create table passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  credential_id bytea not null unique check (octet_length(credential_id) between 1 and 1023),
  -- The COSE key, as the library returns it.
  public_key bytea not null,
  sign_count bigint not null default 0 check (sign_count >= 0),
  transports text[] not null default '{}',
  backed_up boolean not null,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index passkeys_user_id_idx on passkeys (user_id);

create table passkey_challenges (
  -- SHA-256 of the challenge; the challenge itself is never stored.
  challenge_hash bytea primary key,
  kind text not null check (kind in ('register', 'sign-in')),
  user_id bigint references users (id) on delete cascade,
  ip inet,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check ((kind = 'register') = (user_id is not null))
);
create index passkey_challenges_ip_created_idx on passkey_challenges (ip, created_at);
-- For deleting a user's earlier register challenges, and the cascade.
create index passkey_challenges_user_id_idx on passkey_challenges (user_id) where user_id is not null;
