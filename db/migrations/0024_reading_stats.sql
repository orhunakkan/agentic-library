-- Reading stats: the time a signed-in reader spends reading and listening, their daily goal, and the books they
-- finished. Additive only: three tables and one nullable column. Deleting the user deletes all of it.
--
-- reading_time: one counting session, as the browser counted it (src/client/features/reading-stats/tracker.ts). The
-- id is the browser's, so the primary key is (user_id, id) and one account's ids can never touch another's. A session
-- only grows: sent again, it keeps the greater seconds. A row names the kind and the reader's local day, never a book
-- or a page, so deleting a book never changes the time read.
create table reading_time (
  user_id bigint not null references users (id) on delete cascade,
  id uuid not null,
  kind text not null check (kind in ('reading', 'listening')),
  day date not null,
  seconds integer not null check (seconds between 1 and 14400),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index reading_time_user_day_idx on reading_time (user_id, day);

-- finished_books: a book the reader finished, the first time they did (its last page, read aloud's end, or an
-- audiobook's last chapter). A catalogue book (book_slug) or one of the user's private books (user_book_id), never
-- both. Not finished on the Stats page deletes the row; deleting the private book deletes it too.
create table finished_books (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  book_slug text check (char_length(book_slug) between 1 and 200),
  user_book_id uuid references user_books (id) on delete cascade,
  finished_at timestamptz not null default now(),
  check ((book_slug is null) <> (user_book_id is null))
);
create unique index finished_books_user_slug_idx on finished_books (user_id, book_slug) where book_slug is not null;
create unique index finished_books_user_book_idx on finished_books (user_id, user_book_id)
  where user_book_id is not null;
create index finished_books_user_finished_idx on finished_books (user_id, finished_at desc);
-- For the cascade when a private book is deleted.
create index finished_books_book_idx on finished_books (user_book_id) where user_book_id is not null;

-- reading_goals: the daily goal in minutes from a day on, one row per day. A day's goal is the newest row on or
-- before it, so a new goal applies from the day it was set and past days keep theirs. The choices live in code
-- (src/shared/reading-stats/goals.ts); the check is only the range a day can hold.
create table reading_goals (
  user_id bigint not null references users (id) on delete cascade,
  from_day date not null,
  minutes smallint not null check (minutes between 1 and 1440),
  set_at timestamptz not null default now(),
  primary key (user_id, from_day)
);

-- The reader's device's time zone, the latest one heard (with time or a goal), for working out "today". Null until
-- then, when the server uses UTC.
alter table users add column time_zone text check (char_length(time_zone) between 1 and 64);
