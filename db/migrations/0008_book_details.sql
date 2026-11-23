-- Covers and book details for private books. The details are what an EPUB, Markdown front matter or the reader gives,
-- or what the reader applies from an Open Library match: a plain-text description, an ISBN-13, a publisher, a year,
-- and the Open Library work for the link back. The cover is always an image the reader's browser drew or Open Library
-- served, and the server checked by its bytes (JPEG or PNG, its size from its header) before storing it. One cover per
-- book; deleting the book deletes its cover. Additive only: new nullable columns and one new table.

alter table user_books add column description text check (char_length(description) between 1 and 4000);
alter table user_books add column isbn text check (isbn ~ '^97[89][0-9]{10}$');
alter table user_books add column publisher text check (char_length(publisher) between 1 and 200);
alter table user_books add column published_year integer check (published_year between 1 and 2100);
-- The Open Library work the reader applied, for the link back ("Details from Open Library").
alter table user_books add column open_library_work text check (open_library_work ~ '^OL[0-9]{1,12}W$');

create table user_book_covers (
  book_id uuid primary key references user_books (id) on delete cascade,
  -- Only what the server checked: JPEG or PNG, by its bytes.
  media_type text not null check (media_type in ('image/jpeg', 'image/png')),
  bytes bytea not null check (octet_length(bytes) between 1 and 524288),
  width integer not null check (width between 64 and 2400),
  height integer not null check (height between 64 and 3600),
  -- epub, zip, upload or open-library; checked in code, so the list can change there.
  source text not null check (char_length(source) between 1 and 20),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);
