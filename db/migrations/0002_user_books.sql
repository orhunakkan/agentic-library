-- Private books: what a signed-in user imports from their own EPUB or Markdown files. Only the rendered, sanitised
-- pages are stored, never the file. A book is `uploading` until every chapter has arrived, then `ready`; only ready
-- books are shown or readable. Deleting the user deletes their books.

create table user_books (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  author text not null check (char_length(author) between 1 and 200),
  language text not null check (char_length(language) between 2 and 35),
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  chapter_count integer not null check (chapter_count between 1 and 1000),
  -- Rendered HTML across every page, against the per-book limit.
  html_bytes bigint not null default 0 check (html_bytes >= 0),
  created_at timestamptz not null default now(),
  ready_at timestamptz
);
create index user_books_user_id_idx on user_books (user_id);

create table user_book_chapters (
  book_id uuid not null references user_books (id) on delete cascade,
  position integer not null check (position >= 0),
  slug text not null,
  title text not null check (char_length(title) between 1 and 300),
  -- Screen pages of HTML, rendered by the server from checked blocks.
  pages jsonb not null check (jsonb_typeof(pages) = 'array'),
  primary key (book_id, position),
  unique (book_id, slug)
);
