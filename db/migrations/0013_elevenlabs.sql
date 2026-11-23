-- ElevenLabs for read aloud: its keys, the voice model a user picked, and how much speech they generated.
-- Widening the provider check is safe to roll back: the previous release reads and writes only 'anthropic' rows,
-- and lists keys by provider.
alter table api_keys drop constraint api_keys_provider_check,
  add constraint api_keys_provider_check check (provider in ('anthropic', 'elevenlabs'));
-- Null means the default (src/shared/lib/speech-models.ts); checked in code, like ai_model.
alter table users add column speech_model text;
-- One row per user per minute in which read aloud generated speech on their ElevenLabs key; swept after 31 days.
create table speech_usage (
  user_id bigint not null references users (id) on delete cascade,
  minute timestamptz not null,
  characters integer not null check (characters >= 0),
  requests integer not null check (requests >= 0),
  primary key (user_id, minute)
);
