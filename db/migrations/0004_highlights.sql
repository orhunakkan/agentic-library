-- Highlights and notes: passages a signed-in reader marked in a book, each with an optional note. A highlight
-- belongs to a catalogue book (book_slug) or to one of the user's private books (user_book_id), never both. It is
-- anchored by the page it was made on, its offsets in that page's text (UTF-16 units) and the passage itself with a
-- little text either side, so it can be found again if the pages change. Deleting the user or the private book
-- deletes its highlights. There is no check on color, so the list can change in code (src/shared/highlights/colors.ts).

create table highlights (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  book_slug text check (char_length(book_slug) between 1 and 200),
  user_book_id uuid references user_books (id) on delete cascade,
  -- Chapter books: the chapter's slug and the screen page (1-based). Paged books: null and the printed page.
  chapter text check (char_length(chapter) between 1 and 200),
  page integer not null check (page between 1 and 100000),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset),
  exact text not null check (char_length(exact) between 1 and 4000),
  prefix text not null default '' check (char_length(prefix) <= 32),
  suffix text not null default '' check (char_length(suffix) <= 32),
  color text not null,
  note text check (char_length(note) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((book_slug is null) <> (user_book_id is null))
);
create index highlights_user_slug_idx on highlights (user_id, book_slug) where book_slug is not null;
create index highlights_user_book_idx on highlights (user_book_id) where user_book_id is not null;
create index highlights_user_updated_idx on highlights (user_id, updated_at desc);
