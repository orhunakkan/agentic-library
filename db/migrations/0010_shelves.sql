-- Shelves: a signed-in reader's own named groups of books. A book can be on any number of them, so they serve as
-- tags too. name_key is shelfNameKey(name) (src/shared/shelves/shelves.ts), so two shelves can't differ only in case
-- or accents. Deleting the user deletes their shelves. Additive only: two new tables.
create table shelves (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  name_key text not null check (char_length(name_key) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (user_id, name_key),
  -- For shelf_books' foreign key, which makes a row's user the shelf's user.
  unique (id, user_id)
);

-- A book on a shelf: a catalogue book (book_slug) or one of the user's private books (user_book_id), never both.
-- Deleting the shelf, the user or the private book deletes the row.
create table shelf_books (
  shelf_id uuid not null,
  user_id bigint not null references users (id) on delete cascade,
  book_slug text check (char_length(book_slug) between 1 and 200),
  user_book_id uuid references user_books (id) on delete cascade,
  added_at timestamptz not null default now(),
  check ((book_slug is null) <> (user_book_id is null)),
  foreign key (shelf_id, user_id) references shelves (id, user_id) on delete cascade
);
create unique index shelf_books_shelf_slug_idx on shelf_books (shelf_id, book_slug) where book_slug is not null;
create unique index shelf_books_shelf_user_book_idx on shelf_books (shelf_id, user_book_id)
  where user_book_id is not null;
-- For the per-user count and the cascade when a private book is deleted.
create index shelf_books_user_idx on shelf_books (user_id);
create index shelf_books_user_book_idx on shelf_books (user_book_id) where user_book_id is not null;
