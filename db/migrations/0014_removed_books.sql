-- Removed books: catalogue books a signed-in reader took out of their own library. A row hides the book from that
-- reader's library rows, series pages, sidebar and ⌘K search; the book page and the reader still open it, and the
-- catalogue is the same for everyone else. Only catalogue books (book_slug): a private book is deleted instead, so
-- there is no user_book_id. A slug the catalogue no longer has is ignored, and the row brings the book's removal back
-- if it returns. Restoring the book deletes the row; deleting the user deletes their rows. Additive only: one table.
create table removed_books (
  user_id bigint not null references users (id) on delete cascade,
  book_slug text not null check (char_length(book_slug) between 1 and 200),
  removed_at timestamptz not null default now(),
  primary key (user_id, book_slug)
);
