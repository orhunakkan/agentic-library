-- Email: a confirmed address on each account, and the one-use links Folio mails. users.email holds only an address
-- the reader confirmed while signed in; an address waiting for confirmation lives only in its email_tokens row, so
-- nothing can use it first. email_bounced_at is set when Resend reports a permanent bounce, a spam complaint or a
-- suppressed send for the address, and Folio then sends nothing to it. Additive only: three nullable columns, one new
-- table and three indexes.
alter table users add column email text check (char_length(email) between 3 and 254);
alter table users add column email_verified_at timestamptz;
alter table users add column email_bounced_at timestamptz;
-- Addresses aren't unique (a family may share one); lookups compare lower(email).
create index users_email_idx on users (lower(email));

-- One link Folio mailed: `verify` confirms `email` as the account's address, `reset` sets a new password. Only the
-- token's SHA-256 is stored. A row is used up once (used_at), dead after expires_at, and bounced_at marks a pending
-- address that bounced. Rows older than 7 days are swept whenever a token is created; deleting the user deletes them.
create table email_tokens (
  id bigint generated always as identity primary key,
  token_hash bytea not null unique,
  user_id bigint not null references users (id) on delete cascade,
  purpose text not null check (purpose in ('verify', 'reset')),
  email text not null check (char_length(email) between 3 and 254),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  bounced_at timestamptz
);
create index email_tokens_user_purpose_idx on email_tokens (user_id, purpose, created_at);
-- For the reset limit per IP, counted from password.reset_requested events.
create index audit_events_event_ip_at_idx on audit_events (event, ip, at);
