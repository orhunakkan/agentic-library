-- Accounts, sessions, sign-in attempts, API keys and the audit trail (DATABASE.md, "Schema").
-- Content stays in files; the database holds only what belongs to people.

create table users (
  id bigint generated always as identity primary key,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  password_hash text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  password_changed_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table sessions (
  -- SHA-256 of the session token; the token itself is never stored.
  token_hash bytea primary key,
  user_id bigint not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip inet,
  user_agent text check (char_length(user_agent) <= 300)
);
create index sessions_user_id_idx on sessions (user_id);

create table login_attempts (
  id bigint generated always as identity primary key,
  username text not null check (char_length(username) <= 64),
  ip inet,
  succeeded boolean not null,
  at timestamptz not null default now()
);
create index login_attempts_username_at_idx on login_attempts (username, at);
create index login_attempts_ip_at_idx on login_attempts (ip, at);

create table api_keys (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id) on delete cascade,
  provider text not null check (provider in ('anthropic')),
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  kek_id smallint not null,
  last4 text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_validated_at timestamptz,
  unique (user_id, provider)
);

create table audit_events (
  id bigint generated always as identity primary key,
  user_id bigint references users (id) on delete set null,
  event text not null,
  ip inet,
  at timestamptz not null default now(),
  -- Context for the event; never a secret.
  detail jsonb not null default '{}'
);
create index audit_events_user_id_at_idx on audit_events (user_id, at);
