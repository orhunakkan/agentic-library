-- Book ratings: a signed-in reader's stars for one book, 1 to 5, shown on that book's page as Your rating and to
-- nobody else. A row is about exactly one book: a catalogue book (book_slug) or one of the reader's private books
-- (user_book_id), never both. Unrated is the absence of a row, so there is no zero. One row per reader and book: a
-- partial unique index for each kind, which rating again updates (on conflict … where). A catalogue slug the catalogue
-- no longer has is kept and not shown, and its rating comes back if the book does. Clear rating deletes the row,
-- deleting the private book deletes its rating, and deleting the user deletes all of theirs. Additive only: one table.
create table book_ratings (
  user_id bigint not null references users (id) on delete cascade,
  book_slug text check (char_length(book_slug) between 1 and 200),
  user_book_id uuid references user_books (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  rated_at timestamptz not null default now(),
  check ((book_slug is null) <> (user_book_id is null))
);
create unique index book_ratings_user_slug_idx on book_ratings (user_id, book_slug) where book_slug is not null;
create unique index book_ratings_user_book_idx on book_ratings (user_id, user_book_id) where user_book_id is not null;
-- For the cascade when a private book is deleted.
create index book_ratings_user_book_id_idx on book_ratings (user_book_id) where user_book_id is not null;
