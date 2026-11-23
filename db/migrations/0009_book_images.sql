-- A private book's pictures, numbered 1–500 in the order the book first shows them. Only what the server checked:
-- JPEG or PNG by its bytes, which the reader's browser drew. Deleting the book deletes its pictures. Additive only:
-- one new table and two nullable columns.
create table user_book_images (
  book_id uuid not null references user_books (id) on delete cascade,
  n integer not null check (n between 1 and 500),
  media_type text not null check (media_type in ('image/jpeg', 'image/png')),
  bytes bytea not null check (octet_length(bytes) between 1 and 921600),
  width integer not null check (width between 1 and 1600),
  height integer not null check (height between 1 and 4800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (book_id, n)
);

-- What the start request declared: how many pictures the book will have and their bytes in all. Null on books
-- imported before pictures, which have none.
alter table user_books add column image_count integer check (image_count between 0 and 500);
alter table user_books add column image_bytes integer check (image_bytes between 0 and 31457280);
