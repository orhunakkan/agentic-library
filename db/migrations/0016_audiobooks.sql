-- Audiobook uploads: a signed-in reader's own M4B or MP3 audiobook, a private book of its own kind (format 'audio')
-- with no text. The audio itself is kept on disk under AUDIOBOOKS_DIR/<user id>/<book id>/<n>.<m4b|mp3>, never in the
-- database; these rows hold the facts: each file's type, size, how much has arrived and its length as the server read
-- it, and the chapters as windows into the files, each a player episode (its id is its position). A book is
-- `uploading` until every file has arrived whole and been read, then `ready`. Deleting the book deletes its rows (and
-- the server then removes its directory); deleting the user deletes their books.
--
-- Additive only: four nullable columns, two tables, two wider checks and two indexes. Every row the previous release
-- writes still passes the wider checks.

-- Null for a text book.
alter table user_books add column format text check (format = 'audio');
-- "Read by", when the file or the reader names one.
alter table user_books add column narrator text check (char_length(narrator) between 1 and 200);
-- An audiobook's length and its files' bytes in all; null for a text book.
alter table user_books add column audio_ms bigint check (audio_ms >= 0);
alter table user_books add column audio_bytes bigint check (audio_bytes between 0 and 2147483648);

create table user_book_audio_files (
  book_id uuid not null references user_books (id) on delete cascade,
  n integer not null check (n between 1 and 500),
  media_type text not null check (media_type in ('audio/mp4', 'audio/mpeg')),
  -- Declared when the import starts; the file is whole once `received` reaches it.
  bytes bigint not null check (bytes between 1 and 2147483648),
  received bigint not null default 0 check (received between 0 and bytes),
  -- Null until the server has read the finished file.
  duration_ms integer check (duration_ms between 1000 and 172800000),
  created_at timestamptz not null default now(),
  primary key (book_id, n)
);

create table user_book_audio_chapters (
  book_id uuid not null,
  position integer not null check (position between 1 and 1000),
  title text not null check (char_length(title) between 1 and 300),
  file_n integer not null,
  start_ms integer not null check (start_ms >= 0),
  duration_ms integer not null check (duration_ms between 1 and 86400000),
  primary key (book_id, position),
  foreign key (book_id, file_n) references user_book_audio_files (book_id, n) on delete cascade
);
-- For the cascade from a file.
create index user_book_audio_chapters_file_idx on user_book_audio_chapters (book_id, file_n);

-- An episode bookmark or listening place may now belong to a private audiobook (user_book_id) as well as a catalogue
-- book. The episode checks were written without names, so each is found by its definition, the wider one added, and
-- the old one dropped. The checks that exactly one of book_slug and user_book_id is set stay as they are.
do $$
declare
  old_name text;
begin
  select conname into strict old_name from pg_constraint
    where conrelid = 'audio_bookmarks'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind <> ''episode''::text%';
  alter table audio_bookmarks add constraint audio_bookmarks_episode_kind_check
    check (kind <> 'episode' or (episode is not null and position_ms is not null and page is null and exact is null));
  execute format('alter table audio_bookmarks drop constraint %I', old_name);

  select conname into strict old_name from pg_constraint
    where conrelid = 'listening_places'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind <> ''episode''::text%';
  alter table listening_places add constraint listening_places_episode_kind_check
    check (kind <> 'episode' or (episode is not null
      and chapter_index is null and chapter is null and page is null and start_offset is null));
  execute format('alter table listening_places drop constraint %I', old_name);
end
$$;

-- One per episode second, and one place per episode, for private audiobooks too. The existing indexes are on
-- book_slug, which is null on these rows, and nulls are distinct there.
create unique index audio_bookmarks_episode_book_idx on audio_bookmarks (user_id, user_book_id, episode, position_ms)
  where kind = 'episode' and user_book_id is not null;
create unique index listening_places_episode_book_idx on listening_places (user_id, user_book_id, episode)
  where kind = 'episode' and user_book_id is not null;
