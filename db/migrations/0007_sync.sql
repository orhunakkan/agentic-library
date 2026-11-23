-- Sync across devices: where a signed-in reader is, kept in the account so it follows them to every device they sign
-- in on. Each table holds one item per book or episode (or one per user for the settings), never a history:
--   reading_places: the page last read in each book;
--   listening_places: where an audiobook episode stopped (kind 'episode'), or the sentence read aloud stopped at in a
--     book (kind 'voice');
--   reader_settings: the four reader settings that follow the account (theme, font, line spacing and page width).
-- Like bookmarks (0005_bookmarks.sql), a row belongs to a catalogue book (book_slug) or to one of the user's private
-- books (user_book_id), never both.
--
-- `at` is when the reader did it, by their browser's clock, and the newest `at` wins: a write replaces a row only when
-- it is strictly newer (src/server/sync/store.ts), so a tie keeps what is stored. The server never stores an `at`
-- later than its own clock. A finished item is kept rather than deleted, so an older position from another device
-- can't bring it back: an episode played to the end has a null position_ms, and a book read aloud to the end has its
-- chapter, page and offset null. `device` is the browser and system that wrote the row ("Safari on iPhone"), worked
-- out by the server from the request's User-Agent. Deleting the user or the private book deletes the rows.

create table reading_places (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  book_slug text check (char_length(book_slug) between 1 and 200),
  user_book_id uuid references user_books (id) on delete cascade,
  -- Chapter books: the chapter's slug and the screen page (1-based). Paged books: null and the printed page.
  chapter text check (char_length(chapter) between 1 and 200),
  page integer not null check (page between 1 and 100000),
  at timestamptz not null,
  device text not null check (char_length(device) between 1 and 60),
  check ((book_slug is null) <> (user_book_id is null))
);
create unique index reading_places_slug_idx on reading_places (user_id, book_slug) where book_slug is not null;
create unique index reading_places_book_idx on reading_places (user_id, user_book_id) where user_book_id is not null;
create index reading_places_recent_idx on reading_places (user_id, at desc);
-- For the cascade when a private book is deleted.
create index reading_places_user_book_idx on reading_places (user_book_id) where user_book_id is not null;

create table listening_places (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  book_slug text check (char_length(book_slug) between 1 and 200),
  user_book_id uuid references user_books (id) on delete cascade,
  kind text not null check (kind in ('episode', 'voice')),
  -- episode (catalogue books only): the episode's id, and where it stopped in ms; null once played to the end.
  episode text check (char_length(episode) between 1 and 200),
  position_ms integer check (position_ms between 0 and 86400000),
  -- voice: the chapter's index, the page (as reading_places) and the sentence's offset in the page text; all null
  -- once the book was read to the end.
  chapter_index integer check (chapter_index between 0 and 100000),
  chapter text check (char_length(chapter) between 1 and 200),
  page integer check (page between 1 and 100000),
  start_offset integer check (start_offset between 0 and 1000000),
  at timestamptz not null,
  device text not null check (char_length(device) between 1 and 60),
  check ((book_slug is null) <> (user_book_id is null)),
  check (kind <> 'episode' or (book_slug is not null and episode is not null
    and chapter_index is null and chapter is null and page is null and start_offset is null)),
  check (kind <> 'voice' or (episode is null and position_ms is null and (
    (chapter_index is null and chapter is null and page is null and start_offset is null)
    or (chapter_index is not null and page is not null and start_offset is not null))))
);
create unique index listening_places_episode_idx on listening_places (user_id, book_slug, episode)
  where kind = 'episode';
create unique index listening_places_voice_slug_idx on listening_places (user_id, book_slug)
  where kind = 'voice' and book_slug is not null;
create unique index listening_places_voice_book_idx on listening_places (user_id, user_book_id)
  where kind = 'voice' and user_book_id is not null;
create index listening_places_recent_idx on listening_places (user_id, at desc);
create index listening_places_user_book_idx on listening_places (user_book_id) where user_book_id is not null;

create table reader_settings (
  user_id bigint primary key references users (id) on delete cascade,
  -- { theme, font, leading, measure }, checked in code (shared/sync/sync.ts) so the lists can change there.
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  at timestamptz not null,
  device text not null check (char_length(device) between 1 and 60)
);
