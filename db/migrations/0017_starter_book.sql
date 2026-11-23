-- The starter book: every account gets its own private copy of the catalogue's Pride and Prejudice, an ordinary row in
-- user_books that the reader can edit, shelve or delete like any book they imported (src/server/starter-book/).
-- starter_book_at says when the account was given it, or found to have removed the catalogue edition already; null
-- until then. It is never cleared, so a deleted copy never comes back. Additive only: one nullable column.
alter table users add column starter_book_at timestamptz;
