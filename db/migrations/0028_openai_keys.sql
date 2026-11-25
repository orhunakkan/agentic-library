-- OpenAI keys for Ask and Translate. Widening the provider check is safe to roll back: the previous release reads and
-- writes only 'anthropic' and 'elevenlabs' rows, and lists keys by provider. No existing row changes.
alter table api_keys drop constraint api_keys_provider_check,
  add constraint api_keys_provider_check check (provider in ('anthropic', 'elevenlabs', 'openai'));
