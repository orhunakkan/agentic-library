-- Bookmarks: pages a signed-in reader saved to come back to, listed in the reader's Bookmarks tab. A bookmark belongs
-- to a catalogue book (book_slug) or to one of the user's private books (user_book_id), never both. It is anchored
-- as a highlight is (0004_highlights.sql), on the page's opening words: the page it was made on, the first 64 UTF-16
-- units of the page text from its first non-space character, and a little text either side, so a re-import that moves
-- page breaks finds the page where those words are now. There is at most one per stored page. Deleting the user or
-- the private book deletes its bookmarks.

create table bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  book_slug text check (char_length(book_slug) between 1 and 200),
  user_book_id uuid references user_books (id) on delete cascade,
  -- Chapter books: the chapter's slug and the screen page (1-based). Paged books: null and the printed page.
  chapter text check (char_length(chapter) between 1 and 200),
  page integer not null check (page between 1 and 100000),
  -- The page's opening words (up to 64 UTF-16 units) and the text either side, as highlights store a passage.
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset >= start_offset),
  exact text not null check (char_length(exact) <= 64),
  prefix text not null default '' check (char_length(prefix) <= 32),
  suffix text not null default '' check (char_length(suffix) <= 32),
  created_at timestamptz not null default now(),
  check ((book_slug is null) <> (user_book_id is null))
);
-- One bookmark per stored page. NULLS NOT DISTINCT (PostgreSQL 15+) so paged books' null chapter still collides.
create unique index bookmarks_user_slug_page_idx on bookmarks (user_id, book_slug, chapter, page)
  nulls not distinct where book_slug is not null;
create unique index bookmarks_user_book_page_idx on bookmarks (user_id, user_book_id, chapter, page)
  nulls not distinct where user_book_id is not null;
-- For the cascade when a private book is deleted.
create index bookmarks_user_book_idx on bookmarks (user_book_id) where user_book_id is not null;
