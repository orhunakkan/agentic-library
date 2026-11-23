-- Audio bookmarks: moments a signed-in reader marked while listening, listed in the Now playing sheet (and, for read
-- aloud, in the reader's Bookmarks tab). An audio bookmark belongs to a catalogue book (book_slug) or to one of the
-- user's private books (user_book_id), never both, and is one of two kinds:
--   voice: the sentence being read aloud by the device's voice, anchored as a highlight is (0004_highlights.sql) on
--     the sentence's opening words: the page it was made on, up to 64 UTF-16 units of the page text from the first
--     non-space character at the voice's offset, and a little text either side, so a re-import that moves page breaks
--     finds the sentence where those words are now;
--   episode: an audiobook episode and the whole second in it (catalogue books only; private books have no audio).
-- There is at most one per sentence and one per episode second. Deleting the user or the private book deletes them.

create table audio_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  book_slug text check (char_length(book_slug) between 1 and 200),
  user_book_id uuid references user_books (id) on delete cascade,
  kind text not null check (kind in ('voice', 'episode')),
  -- episode: the audiobook episode's id and the whole second in it. Catalogue books only.
  episode text check (char_length(episode) between 1 and 200),
  position_ms integer check (position_ms between 0 and 86400000),
  -- voice: the sentence's anchor, as a highlight's: the page, the opening words and the text either side.
  chapter text check (char_length(chapter) between 1 and 200),
  page integer check (page between 1 and 100000),
  start_offset integer check (start_offset >= 0),
  end_offset integer check (end_offset >= start_offset),
  exact text check (char_length(exact) between 1 and 64),
  prefix text check (char_length(prefix) <= 32),
  suffix text check (char_length(suffix) <= 32),
  created_at timestamptz not null default now(),
  check ((book_slug is null) <> (user_book_id is null)),
  check (kind <> 'episode' or (book_slug is not null and episode is not null and position_ms is not null
    and page is null and exact is null)),
  check (kind <> 'voice' or (episode is null and position_ms is null and page is not null
    and start_offset is not null and end_offset is not null and exact is not null
    and prefix is not null and suffix is not null))
);
-- One per sentence, and one per episode second.
create unique index audio_bookmarks_voice_slug_idx on audio_bookmarks (user_id, book_slug, chapter, page, start_offset)
  nulls not distinct where kind = 'voice' and book_slug is not null;
create unique index audio_bookmarks_voice_book_idx on audio_bookmarks (user_id, user_book_id, chapter, page, start_offset)
  nulls not distinct where kind = 'voice' and user_book_id is not null;
create unique index audio_bookmarks_episode_idx on audio_bookmarks (user_id, book_slug, episode, position_ms)
  where kind = 'episode';
-- For the cascade when a private book is deleted.
create index audio_bookmarks_user_book_idx on audio_bookmarks (user_book_id) where user_book_id is not null;
