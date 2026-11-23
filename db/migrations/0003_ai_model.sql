-- The Claude model a user picked for the agent features (Ask the book first), on /account/api-keys. Null means the
-- default. There is no check constraint, so the list of models can change in code (src/lib/ai-models.ts) without a
-- migration; the server treats a value it doesn't know as the default.

alter table users add column ai_model text;
