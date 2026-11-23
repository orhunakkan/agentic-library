-- Your prompts: a Pro reader's own saved requests for Ask the book, run from the Ask panel's Your prompts menu. A row
-- is one prompt: a name (one line, unique per reader ignoring case), the instruction sent to Anthropic when it runs,
-- what it runs on (applies_to: 'pages' or 'passage', checked in code so a third kind needs no migration), and the
-- reader's own order (position, not unique, so moving a prompt is a swap with no deferred constraint; reads order by
-- position, then created_at). Delete removes the row, and deleting the user deletes all of theirs. The 20 a reader may
-- keep is counted in code under the user-row lock. Additive only: one table.
create table ask_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  instruction text not null check (char_length(instruction) between 1 and 2000),
  applies_to text not null,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ask_prompts_user_name_idx on ask_prompts (user_id, lower(name));
create index ask_prompts_user_position_idx on ask_prompts (user_id, position);
